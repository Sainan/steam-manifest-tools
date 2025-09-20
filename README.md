Scripts to interact with Steam manifest files.
- `node download-chunks.js <manifest file>` (basically the same as prefilling a LAN cache)
- `node populate-chunks.js <depot id> <depot key> <install dir>` (can also be used to prefill a LAN cache, tho compression is not as good as Steam's)
- `node to-json.js <manifest file> [depot key]`
- `node to-hashdeep-auditfile.js <manifest file> [depot key]`
  - Note that hashdeep requires exact path matches and this script makes a few assumptions
  - Example verification usage: `hashdeep -a -l -v -v -k 241561_8497448424664183398.manifest.auditfile -r 8497448424664183398`
