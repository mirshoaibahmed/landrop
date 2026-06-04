# LANDrop

Fast, private peer-to-peer file transfer across devices on the same network.

LANDrop is a side project built to explore modern browser-based file transfer using WebRTC, with a focus on speed, privacy, reliability, and a clean user experience. It allows devices on the same network to discover each other and transfer files directly without uploading data to the cloud.

> No cloud. No accounts. No limits.

---

## Features

### Device Discovery

* Automatic device detection on the same network
* Quick Connect support
* Trusted Devices for faster connections

### File Transfer

* Single file transfer
* Multi-file transfer
* Folder transfer
* ZIP mode for preserving folder structure
* Drag & drop support

### Reliability

* Chunk-level SHA-256 verification
* Full-file SHA-256 verification
* Large file streaming support
* Transfer queue management
* Pause and resume transfers
* Active transfer cancellation

### User Experience

* Modern responsive interface
* Mobile-friendly design
* Transfer progress tracking
* Real-time transfer speed monitoring
* Premium connection and transfer dialogs

### Privacy

* Peer-to-peer transfers using WebRTC
* No cloud storage
* No account required
* Local network communication

---

## Tech Stack

### Frontend

* HTML5
* CSS3
* JavaScript (ES6+)

### Backend

* Python
* Flask
* Flask-SocketIO

### Transfer Layer

* WebRTC DataChannel
* Socket.IO Signaling

### Storage & Utilities

* IndexedDB
* JSZip
* StreamSaver.js

---

## Project Status

LANDrop is currently under active development.

### Current Status

* Device Discovery
* Trusted Devices
* Multi-file Transfer
* Folder Transfer
* ZIP Mode
* Transfer Queue
* Pause / Resume
* Transfer Cancellation
* Chunk Verification
* Large File Streaming

### In Progress

* Resume After Disconnect
* Transfer Recovery
* Improved Device Pairing
* Performance Optimizations

### Planned

* Installable PWA
* QR Code Pairing
* Device Avatars
* Settings Page
* Enhanced Transfer Analytics

---

## Coming Soon

### LANDrop for Android

Native Android application currently planned.

### LANDrop for iOS

Native iPhone and iPad application currently planned.

### Official Website

A dedicated LANDrop website and documentation portal are coming soon.

---

## Why LANDrop?

Most file transfer solutions either:

* Require cloud uploads
* Require user accounts
* Limit transfer sizes
* Depend on external servers

LANDrop aims to provide a simple alternative:

* Direct device-to-device transfers
* Local-first architecture
* No account creation
* No unnecessary complexity

---

## Getting Started

### Clone the Repository

```bash
git clone https://github.com/mirshoaibahmed/landrop.git
cd landrop
```

### Create Virtual Environment

```bash
python -m venv venv
```

### Activate Environment

Windows:

```bash
venv\Scripts\activate
```

macOS / Linux:

```bash
source venv/bin/activate
```

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Run LANDrop

```bash
python app.py
```

Open:

```text
http://localhost:55111
```

or use your local network IP to access it from other devices.

---

## Screenshots

Screenshots and demos will be added soon.

---

## Contributing

Contributions, ideas, bug reports, and feature suggestions are welcome.

If you find an issue or have an improvement idea, please open an issue or submit a pull request.

---

## License

Licensed under the Apache License 2.0.

See the LICENSE file for details.

---

## Author

**Mir Shoaib Ahmed**

Software Engineer & Technology Enthusiast

GitHub: https://github.com/mirshoaibahmed

---

### Disclaimer

LANDrop is currently a personal side project and is under active development. Features, APIs, and behavior may change as the project evolves.
