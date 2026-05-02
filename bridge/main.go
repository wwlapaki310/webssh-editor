package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// InMsg is a message from the browser to the bridge.
type InMsg struct {
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Auth     string `json:"auth"`     // "pw" | "key" | "agent"
	Password string `json:"password"`
	KeyPEM   string `json:"key_pem"`
	Path     string `json:"path"`
	Content  string `json:"content"`
	Data     string `json:"data"`
	Cols     int    `json:"cols"`
	Rows     int    `json:"rows"`
}

// OutMsg is a message from the bridge to the browser.
type OutMsg struct {
	Type    string  `json:"type"`
	Cwd     string  `json:"cwd,omitempty"`
	Path    string  `json:"path,omitempty"`
	Content string  `json:"content,omitempty"`
	Entries []Entry `json:"entries,omitempty"`
	Data    string  `json:"data,omitempty"`
	Message string  `json:"message,omitempty"`
}

// Entry is a single file/directory in an ls result.
type Entry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

func main() {
	port := flag.Int("port", 8765, "HTTP listen port")
	dir := flag.String("dir", "..", "directory to serve static files from")
	flag.Parse()

	http.HandleFunc("/ws", handleWS)
	http.Handle("/", http.FileServer(http.Dir(*dir)))

	addr := fmt.Sprintf("localhost:%d", *port)
	log.Printf("WebSSH Editor bridge → http://%s  (static files from %q)", addr, *dir)
	log.Fatal(http.ListenAndServe(addr, nil))
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("ws upgrade:", err)
		return
	}

	var mu sync.Mutex
	send := func(msg OutMsg) {
		data, _ := json.Marshal(msg)
		mu.Lock()
		defer mu.Unlock()
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Println("ws write:", err)
		}
	}

	sess := &Session{send: send}
	defer func() {
		sess.Close()
		conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg InMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			send(OutMsg{Type: "error", Message: "invalid JSON: " + err.Error()})
			continue
		}
		if err := sess.Handle(msg); err != nil {
			send(OutMsg{Type: "error", Message: err.Error()})
		}
	}
}
