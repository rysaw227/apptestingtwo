# Ham — Roomba i3+ read-only diagnostics

This is an opt-in, read-only local diagnostic utility for a Roomba i3+ (SKU i355020; owner-reported software 2.6.0). It never initiates Wi-Fi pairing, resets, cleaning, docking, firmware updates, or settings modifications.

## What is implemented

- **Safe TCP probe** (default): checks whether the Roomba is reachable on TCP 8883, without sending MQTT commands.
- **UDP public discovery** (option --discover): sends only the documented irobotmcs discovery request to UDP 5678; if the Roomba responds, shows its model, name, firmware and protocol. This does not require pairing or authentication. The robot may not respond on some network/firmware configurations. BLIDs, serial numbers, MAC addresses and raw packets are omitted.
- **Optional authenticated read-only telemetry** (option --read): only with local credentials already obtained by a separate means, uses dorita980 to read available battery, mission, error, bin, Wi-Fi signal, runtime and firmware fields. Some fields may be absent.
- **Offline automated tests**: use mock TCP and UDP servers; never connect to a physical robot.

## Important boundaries

- **The robot must already be connected to the same LAN as the device running this utility.** GitHub and cloud Codex cannot directly access a device on a private home Wi-Fi network. This code does not connect Ham from the cloud.
- The last known address was 192.168.1.99, but Spectrum may reassign it. Set HAM_IP locally if the address differs.
- Even a read-only **authenticated MQTT** connection can temporarily compete with the iRobot app because some firmware supports only one local session at a time. The utility releases the connection after reading. The unauthenticated TCP/UDP checks avoid that issue.
- No pairing mode is required or invoked. No factory resets or Wi-Fi changes are implemented.
- No passwords, authentication tokens, BLIDs, Wi-Fi secrets, or personal identifiers belong in this public GitHub repository.
- Firmware-specific telemetry must be verified on the actual robot. The script has been tested against mock network services only, **not against Ham**.

## Local execution (only on a machine already on Ham's home Wi-Fi)

Node.js 18+ is required; TCP/UDP probes use built-in libraries without installing any extra package:

    node ham.cjs
    node ham.cjs --discover
    node --test ham.test.cjs

For authenticated read-only status, the owner must already have local credentials and dorita980 must be available locally. Do not repeat the local pairing procedure to obtain credentials. Keep them entirely in local environment variables:

    HAM_BLID='<existing BLID>' HAM_PASSWORD='<existing robot password>' node ham.cjs --read

Cloud GitHub/Codex cannot execute the local-network checks without an independently and explicitly established local execution path.

## Diagnostic interpretation

A TCP OPEN result confirms that the device accepts network connections on port 8883. It does not establish authentication or diagnosis. UDP discovery may confirm its local identity, model and firmware. MQTT read-only status fields, when available, may show battery percent, cleaning state, error/not-ready codes, bin indication, signal level and runtime statistics. None alone proves the cause of slow or glitchy behavior.

The owner's iRobot Home app currently shows a Product Health alert that some parts are due for replacement. The specific parts are not identified by this project.

Open-source reference: https://github.com/koalazak/dorita980
