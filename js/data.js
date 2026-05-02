// Sample file contents for the prototype editor.
// In production these would be fetched via SFTP from the remote host.

const FILES = {
  'main.py': `#!/usr/bin/env python3
"""
IMX500 Edge Inference
Entry point for real-time object detection on Raspberry Pi.
"""
import argparse
import cv2
import numpy as np
from picamera2 import Picamera2
from src.model import IMX500Model
from src.config import Config


def parse_args():
    parser = argparse.ArgumentParser(description='IMX500 inference')
    parser.add_argument('--device', default='imx500')
    parser.add_argument('--threshold', type=float, default=0.5)
    return parser.parse_args()


def main():
    args = parse_args()
    cfg = Config(threshold=args.threshold)
    model = IMX500Model(cfg.model_path)
    cam = Picamera2()
    cam.start()

    while True:
        frame = cam.capture_array()
        detections = model.infer(frame)
        for det in detections:
            cv2.rectangle(frame, det.bbox, (0, 255, 0), 2)
        if cv2.waitKey(1) == ord('q'):
            break
    cam.stop()


if __name__ == '__main__':
    main()
`,

  'model.py': `"""IMX500Model - wraps Sony IMX500 NPU inference."""
import numpy as np
from dataclasses import dataclass
from typing import List


@dataclass
class Detection:
    label: str
    score: float
    bbox: tuple


class IMX500Model:
    def __init__(self, model_path: str):
        self.model_path = model_path
        self.labels = self._load_labels()
        self._load()

    def _load(self):
        # Load .rpk model onto the IMX500 NPU
        print(f'[INFO] Loading: {self.model_path}')

    def _load_labels(self) -> List[str]:
        return ['person', 'bicycle', 'car', 'cat', 'dog']

    def infer(self, frame: np.ndarray) -> List[Detection]:
        tensor = self.preprocess(frame)
        return self.postprocess(self._run_npu(tensor))

    def preprocess(self, frame):
        import cv2
        return cv2.resize(frame, (224, 224)) / 255.0

    def _run_npu(self, tensor): pass

    def postprocess(self, raw) -> List[Detection]:
        return []
`,

  'config.py': `"""Configuration for IMX500 inference pipeline."""
from dataclasses import dataclass


@dataclass
class Config:
    model_path: str = 'models/mobilenet_v2_imx500.rpk'
    device: str = '/dev/video0'
    threshold: float = 0.5
    max_fps: int = 30
    input_size: tuple = (224, 224)
`,

  'test_model.py': `"""Unit tests for IMX500Model."""
import pytest
import numpy as np
from src.model import IMX500Model
from src.config import Config


@pytest.fixture
def model():
    return IMX500Model(Config().model_path)


def test_model_loads(model):
    assert model is not None


def test_preprocess_shape(model):
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    tensor = model.preprocess(frame)
    assert tensor.shape == (224, 224, 3)
`,

  'requirements.txt': `picamera2>=0.3.12
opencv-python-headless>=4.8.0
numpy>=1.24.0
pytest>=7.4.0
`,

  'README.md': `# IMX500 Edge Inference

Real-time object detection on Raspberry Pi using Sony IMX500.

## Setup

    pip install -r requirements.txt

## Usage

    python src/main.py --device imx500 --threshold 0.5
`,
};

// Tracks last-saved content per file (Ctrl+S).
// Initialized to match FILES so no files start as "modified".
const savedFiles = {};
Object.keys(FILES).forEach(k => { savedFiles[k] = FILES[k]; });
