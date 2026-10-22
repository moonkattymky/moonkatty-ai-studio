# Verifying a correction to a published item

Studio 2 produces the script package. Studio 5 keeps the corrections log. QA re-checks the correction and returns a verification record. QA does not write that log, does not publish, and does not unpublish.

The machine-readable steps are `PROCEDURE` in `qa/content/corrections.mjs`. They are repeated here so a person can follow them without reading the module.

1. Studio 5 stores the published snapshot as before and the replacement as after, with the sources that were stored at publication.
2. Copy the finding ids from the original QC verdict into addresses. Those are the defects this correction claims to fix.
3. QA runs the same checker on before and confirms every addressed id is present. An id that is absent does not match the published defect.
4. QA runs the checker on after. Every addressed id must be gone, unless Studio 5 attached a waiver with a note of at least 10 characters.
5. after must not introduce a new blocker or major finding.
6. before and after must differ in body, claims, or images. An unchanged package is not a correction.
7. The corrections log keeper must be studio-5. QA returns a verification record and does not write the log.
8. Only a verified result may be marked corrected. not_verified stays open. QA does not publish or unpublish.

Run it:

```bash
node qa/content/cli.mjs --correction path/to/correction.json
```

Exit code 0 means `verified`. Exit code 1 means `not_verified`. The JSON on stdout is the record Studio 5 can append. The input and output shapes are in `qa/CONTRACTS.md`.
