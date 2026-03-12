# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ChangeLens, please report it responsibly.

**Email:** jordanmstepp@gmail.com  
**Subject:** `[SECURITY] ChangeLens — <brief description>`

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

## Scope

ChangeLens is a static analysis tool that runs locally. It:
- **Does NOT** make network requests
- **Does NOT** execute or evaluate code from diffs
- **Does NOT** send telemetry or analytics
- **Does NOT** require authentication

The primary attack surface is maliciously crafted diff input designed to exploit regex patterns or cause denial of service via pathological input.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | ✅ Current |
