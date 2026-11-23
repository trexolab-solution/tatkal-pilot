# IRCTC Autofill

A Chrome extension that speeds up **Tatkal** bookings on the new IRCTC site (`irctc.co.in/eticket`). You log in and press **BOOK** and **Pay**; the extension fills in the rest.

Built by Pintu Prajapati.

## What it does

- Fills From, To, date and the Tatkal quota, then searches trains.
- Finds your exact train, opens Check Availability and highlights the BOOK button for your class.
- Adds passengers from your master list (or as new passengers), sets payment (UPI by default), "Book only if confirmed berth", mobile number and other options.
- Optional timed search at the Tatkal opening time (10:00 for AC, 11:00 for non-AC).
- Saves several bookings. Retries are limited, and the run stops if you log out.

## What it does not do

- It never logs in for you and never handles passwords or OTPs.
- It never presses **Pay & Book** and never touches the payment step.
- It does not bypass CAPTCHAs.

## Install

Requires Node.js 20 or newer.

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select `.output/chrome-mv3`.

For development, run `npm run dev`.

## Use

1. Click the extension icon, then **New booking**, and fill in the journey and passengers.
2. Open IRCTC and log in.
3. Press **Start** in the floating panel. Press **BOOK** yourself when it is highlighted.

## Train and station lookup

Suggestions work offline from a built-in list. Stations refresh from the India API once a day (or from **Settings → Update now**). Trains are learned from IRCTC as you browse. An optional free RailCore key adds live train search; it is never required.

## Tech

TypeScript, [WXT](https://wxt.dev), Manifest V3.

## Disclaimer

An unofficial tool, not affiliated with IRCTC or Indian Railways. Use it within IRCTC's terms.

## Data

Built-in lists: Datameet (CC0). Station updates: India API (CC BY-SA 4.0).
