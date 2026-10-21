# Ham / Roomba i3+ — Read-only diagnostics

This project checks local connectivity to Ham (iRobot Roomba i3+, firmware 2.6.0) and, only when device-specific local credentials are already available, retrieves read-only diagnostic status.

This code contains no Wi-Fi pairing, network provisioning, cleaning, docking, reset, firmware or settings-modification commands.

Critical limitation: Ham must already be on the home Wi-Fi. GitHub/Codex cloud cannot reach private home-network IPs and this tool cannot bring an offline Roomba online.

The default local address (192.168.1.99) came from an earlier Spectrum router view and may change upon reconnection.

Node.js commands on a local device:
- node ham.cjs — TCP probe for port 8883; does not transmit MQTT commands.
- HAM_IP=192.168.1.123 node ham.cjs — substitute the current local IP.
- node ham.cjs --read — optional authenticated read-only diagnostics, only with HAM_BLID and HAM_PASSWORD already set locally.
- node --test ham.test.cjs — unit tests without contacting a Roomba.

Never share or commit robot credentials, iRobot passwords, or network secrets. Firmware compatibility is not guaranteed; this has not been tested on Ham.

Reference: https://github.com/koalazak/dorita980
