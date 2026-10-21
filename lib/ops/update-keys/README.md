# Pinned release signing key (Ed25519)

`release-ed25519.pub.pem` — the ONLY key the Update Center trusts for `release-manifest.json.sig`.

The key committed now is a **placeholder**: its private half was discarded at generation time, so no
release can currently pass signature verification → every release is "unverified, manual only".
Replace it with the public key of the offline-generated release key (see docs/ops/UPDATE_CENTER.md,
"Signed updates rollout"). Rotating the key = a reviewed commit changing this file. Private keys never go into git.
