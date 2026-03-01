#!/usr/bin/env node

import { spawn } from 'node:child_process'

const DEFAULT_LAT = 43.074
const DEFAULT_LON = -89.384
const LAT_LIMIT = 85.051129
const LON_LIMIT = 180
const DEFAULT_BASE_URL = 'http://localhost:5173'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function printHelp() {
  console.log(`Build or open the Area 3D URL.

Usage:
  npm run area3d -- --lat 43.074 --lon -89.384
  npm run area3d -- --lat 43.074 --lon -89.384 --open
  npm run area3d -- --base-url http://localhost:4173

Options:
  --lat <number>       Latitude in [-85.051129, 85.051129] (default: ${DEFAULT_LAT})
  --lon <number>       Longitude in [-180, 180] (default: ${DEFAULT_LON})
  --base-url <url>     Base URL for the app (default: ${DEFAULT_BASE_URL})
  --open               Open the generated URL in your default browser
  -h, --help           Show this help message`)
}

function parseNumberFlag(name, value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    fail(`${name} must be a finite number.`)
  }
  return parsed
}

function assertInRange(name, value, min, max) {
  if (value < min || value > max) {
    fail(`${name} must be between ${min} and ${max}. Received: ${value}.`)
  }
}

function parseArgs(argv) {
  const args = {
    lat: DEFAULT_LAT,
    lon: DEFAULT_LON,
    baseUrl: DEFAULT_BASE_URL,
    open: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--open') {
      args.open = true
      continue
    }

    if (arg === '-h' || arg === '--help') {
      printHelp()
      process.exit(0)
    }

    if (arg === '--lat' || arg === '--lon' || arg === '--base-url') {
      const next = argv[i + 1]
      if (next == null || next.startsWith('--')) {
        fail(`Missing value for ${arg}.`)
      }

      if (arg === '--lat') {
        args.lat = parseNumberFlag('--lat', next)
      } else if (arg === '--lon') {
        args.lon = parseNumberFlag('--lon', next)
      } else {
        args.baseUrl = next
      }

      i += 1
      continue
    }

    fail(`Unknown argument: ${arg}`)
  }

  assertInRange('--lat', args.lat, -LAT_LIMIT, LAT_LIMIT)
  assertInRange('--lon', args.lon, -LON_LIMIT, LON_LIMIT)

  let parsedBaseUrl
  try {
    parsedBaseUrl = new URL(args.baseUrl)
  } catch {
    fail('--base-url must be a valid absolute URL, e.g. http://localhost:5173')
  }

  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    fail('--base-url must use http or https.')
  }

  return args
}

function openInBrowser(url) {
  const platform = process.platform
  if (platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }

  if (platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
    child.unref()
    return
  }

  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.unref()
}

const args = parseArgs(process.argv.slice(2))
const baseUrl = new URL(args.baseUrl)
const areaUrl = new URL('/area-3d.html', baseUrl)
areaUrl.searchParams.set('lat', String(args.lat))
areaUrl.searchParams.set('lon', String(args.lon))

console.log(areaUrl.toString())

if (args.open) {
  try {
    openInBrowser(areaUrl.toString())
  } catch (error) {
    fail(`Failed to open browser: ${error instanceof Error ? error.message : String(error)}`)
  }
}
