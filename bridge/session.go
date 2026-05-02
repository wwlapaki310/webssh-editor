package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// Session holds one browser ↔ SSH connection.
type Session struct {
	send   func(OutMsg)
	client *ssh.Client
	sftp   *sftp.Client
	shell  *ssh.Session
	stdin  io.WriteCloser
}

func (s *Session) Close() {
	if s.shell != nil {
		s.shell.Close()
		s.shell = nil
	}
	if s.sftp != nil {
		s.sftp.Close()
		s.sftp = nil
	}
	if s.client != nil {
		s.client.Close()
		s.client = nil
	}
}

func (s *Session) Handle(msg InMsg) error {
	switch msg.Type {
	case "connect":
		return s.connect(msg)
	case "ls":
		return s.ls(msg.Path)
	case "read":
		return s.readFile(msg.Path)
	case "write":
		return s.writeFile(msg.Path, msg.Content)
	case "term_input":
		return s.termInput(msg.Data)
	case "resize":
		return s.resize(msg.Cols, msg.Rows)
	case "disconnect":
		s.Close()
		s.send(OutMsg{Type: "disconnected"})
		return nil
	default:
		return fmt.Errorf("unknown message type: %s", msg.Type)
	}
}

func (s *Session) connect(msg InMsg) error {
	var auths []ssh.AuthMethod

	switch msg.Auth {
	case "pw", "password":
		pw := msg.Password
		auths = append(auths, ssh.Password(pw))
		// Some PAM-based hosts use keyboard-interactive instead of password.
		auths = append(auths, ssh.KeyboardInteractive(func(_, _ string, questions []string, _ []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range answers {
				answers[i] = pw
			}
			return answers, nil
		}))
	case "key":
		signer, err := ssh.ParsePrivateKey([]byte(msg.KeyPEM))
		if err != nil {
			return fmt.Errorf("invalid private key: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	case "agent":
		socket := os.Getenv("SSH_AUTH_SOCK")
		if socket == "" {
			return fmt.Errorf("SSH_AUTH_SOCK not set — SSH agent not available")
		}
		agentConn, err := net.Dial("unix", socket)
		if err != nil {
			return fmt.Errorf("SSH agent connection failed: %w", err)
		}
		auths = append(auths, ssh.PublicKeysCallback(agent.NewClient(agentConn).Signers))
	default:
		return fmt.Errorf("unknown auth type: %q", msg.Auth)
	}

	port := msg.Port
	if port == 0 {
		port = 22
	}

	cfg := &ssh.ClientConfig{
		User:            msg.User,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: known_hosts verification
		Timeout:         15 * time.Second,
	}

	client, err := ssh.Dial("tcp", fmt.Sprintf("%s:%d", msg.Host, port), cfg)
	if err != nil {
		return fmt.Errorf("SSH connection failed: %w", err)
	}
	s.client = client

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		client.Close()
		return fmt.Errorf("SFTP init failed: %w", err)
	}
	s.sftp = sftpClient

	cwd, err := sftpClient.Getwd()
	if err != nil || cwd == "" {
		cwd = "/"
	}
	s.send(OutMsg{Type: "connected", Cwd: cwd})

	return s.startShell()
}

func (s *Session) startShell() error {
	sess, err := s.client.NewSession()
	if err != nil {
		return fmt.Errorf("new SSH session: %w", err)
	}
	s.shell = sess

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 38400,
		ssh.TTY_OP_OSPEED: 38400,
	}
	if err := sess.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		sess.Close()
		return fmt.Errorf("PTY request: %w", err)
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return fmt.Errorf("stdin pipe: %w", err)
	}
	s.stdin = stdin

	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		return fmt.Errorf("stdout pipe: %w", err)
	}

	stderr, err := sess.StderrPipe()
	if err != nil {
		sess.Close()
		return fmt.Errorf("stderr pipe: %w", err)
	}

	if err := sess.Shell(); err != nil {
		sess.Close()
		return fmt.Errorf("start shell: %w", err)
	}

	pipe := func(r io.Reader) {
		buf := make([]byte, 4096)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				s.send(OutMsg{Type: "term_output", Data: string(buf[:n])})
			}
			if err != nil {
				break
			}
		}
	}
	go pipe(stdout)
	go pipe(stderr)

	return nil
}

func (s *Session) termInput(data string) error {
	if s.stdin == nil {
		return fmt.Errorf("terminal not ready")
	}
	_, err := io.WriteString(s.stdin, data)
	return err
}

func (s *Session) resize(cols, rows int) error {
	if s.shell == nil || cols == 0 || rows == 0 {
		return nil
	}
	return s.shell.WindowChange(rows, cols)
}

func (s *Session) ls(dir string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP not ready")
	}
	if dir == "" {
		dir = "."
	}
	infos, err := s.sftp.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("ls %q: %w", dir, err)
	}
	entries := make([]Entry, 0, len(infos))
	for _, fi := range infos {
		if len(fi.Name()) > 0 && fi.Name()[0] == '.' {
			continue // skip hidden files
		}
		entries = append(entries, Entry{
			Name:  fi.Name(),
			IsDir: fi.IsDir(),
			Size:  fi.Size(),
		})
	}
	s.send(OutMsg{Type: "ls_result", Path: dir, Entries: entries})
	return nil
}

func (s *Session) readFile(p string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP not ready")
	}
	f, err := s.sftp.Open(p)
	if err != nil {
		return fmt.Errorf("read %q: %w", p, err)
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return fmt.Errorf("read %q: %w", p, err)
	}
	s.send(OutMsg{Type: "read_result", Path: p, Content: string(data)})
	return nil
}

func (s *Session) writeFile(p, content string) error {
	if s.sftp == nil {
		return fmt.Errorf("SFTP not ready")
	}
	if dir := path.Dir(p); dir != "." && dir != "/" {
		_ = s.sftp.MkdirAll(dir)
	}
	f, err := s.sftp.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("write %q: %w", p, err)
	}
	defer f.Close()
	if _, err := io.WriteString(f, content); err != nil {
		return fmt.Errorf("write %q: %w", p, err)
	}
	s.send(OutMsg{Type: "write_ok", Path: p})
	return nil
}
