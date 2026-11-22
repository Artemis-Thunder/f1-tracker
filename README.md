# 🏎️ F1 Dot Tracker — Live Race Tracker & Telemetry Dashboard

[![Live Demo](https://img.shields.io/badge/Live-Demo-e10600?style=for-the-badge&logo=vercel&logoColor=white)](https://f1-dot-tracker.vercel.app/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](#)
[![HTML5 Canvas](https://img.shields.io/badge/HTML5-Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white)](#)
[![CSS3](https://img.shields.io/badge/CSS3-Modern_Grid_%26_Flex-1572B6?style=for-the-badge&logo=css3&logoColor=white)](#)
[![OpenF1 API](https://img.shields.io/badge/Data-OpenF1_API-00B4D8?style=for-the-badge)](#)

> **Ever wondered while watching F1:** *"What if I could see the entire track and every live position for free?"*  
> Well, here it is! **F1 Dot Tracker** is a lightweight, zero-dependency Formula 1 race replay and telemetry pit wall built with pure JavaScript and HTML5 Canvas. Stream live GPS radar, driver throttle/brake inputs, tire stints, and race control events straight to your screen without any paywalls or subscriptions.

---

## 📸 Key Features

- **Interactive 2D Circuit Map**: High-precision track coordinate rendering via HTML5 Canvas with normalized aspect ratios, dynamic rotation, and auto-scaling.
- **Real-Time Driver Positioning**: Live GPS tracking of all drivers with team colors, acronym tags, and smooth sub-second interpolation.
- **Dynamic Leaderboard**: Live positions, interval gaps to leader, sector times, current lap counters, and Pirelli tire compound indicators (Soft, Medium, Hard, Intermediate, Wet).
- **Telemetry Inspection**: Click any driver to inspect real-time car metrics:
  - Instantaneous Speed ($km/h$)
  - Gear indicator
  - Engine RPM
  - Throttle & Brake pressure gauges
  - DRS flap status (Open / Closed)
- **Session Controls & Timeline**: Full playback controls with scrubbable timeline slider, play/pause (with `Space` hotkey), and multi-speed replay ($1\times, 2\times, 5\times, 10\times, 20\times, 50\times$).
- **Live Environmental & Race Control Feeds**: Track & air temperatures, rainfall detection, track humidity, wind speed, pressure, and race control messages (Yellow flag, Green flag, Safety Car, VSC).

---

## 🛠️ Architecture & Data Sources

The project runs 100% in the client's browser, utilizing modern asynchronous pipelines and request throttling:

1. **[OpenF1 API](https://openf1.org)**: Primary data source for session records, driver rosters, interval gaps, lap timing, weather conditions, pit stints, and high-frequency car telemetry.
2. **[MultiViewer Circuit API](https://api.multiviewer.app)**: Real-world GPS circuit topologies and rotational calibrations. Features automatic fallback to driver GPS interpolation if external vector data is unavailable.
3. **Throttled Request Queue**: Built-in rate limiter handling HTTP 429 backoff and burst protections to respect public API quotas.

---

## 🚀 Quick Start (Local Run)

No build tools, bundlers, or `npm install` needed!

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Artemis-Thunder/f1-tracker.git
   cd f1-tracker
   ```

2. **Open in any modern browser:**
   - Double-click `index.html`, OR
   - Serve using any static server (e.g. VS Code Live Server, or Python):
     ```bash
     python -m http.server 5500
     ```
   - Open `http://localhost:5500/` in your browser.

---

## 🌐 Deployment (GitHub Pages)

This project is a static web app and deploys to **GitHub Pages** in under 60 seconds:

1. Push this repository to GitHub under `https://github.com/Artemis-Thunder/f1-tracker`.
2. Go to repository **Settings** -> **Pages** (under Code and automation).
3. Under **Branch**, select `main` (or `master`) and folder `/ (root)`.
4. Click **Save**.
5. Your live app will be published at `https://artemis-thunder.github.io/f1-tracker/`.

---

## ⌨️ Keyboard Shortcuts

- `Space` — Toggle Play / Pause
- `→` (Right Arrow) — Fast forward timeline +1%
- `←` (Left Arrow) — Rewind timeline -1%

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
Formula 1 and related marks are trademarks of Formula One Licensing B.V. Telemetry data is provided for personal and non-commercial educational purposes via OpenF1.
