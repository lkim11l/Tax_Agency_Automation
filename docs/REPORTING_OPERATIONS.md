# Reporting operations

## Generate and download

1. Sign in as an active specialist or administrator.
2. Open `/reports`, select a period, and generate the XLSX.
3. Repeated identical requests reuse the completed private artifact.
4. Administrators may select force regeneration and provide a reason.
5. Download from report history. The application issues a 60-second signed URL.

Files are stored in the private `report-exports` bucket. Completed metadata is
immutable. Audit covers registry view/filter, generation start/success/failure,
cache hit, forced regeneration, and download; metadata contains no row values.

## Acceptance

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:reports:live
npm run build
npm audit
```

The live test uses existing synthetic Phase 1–7 records, verifies scope,
pagination, totals, private persistence, SHA-256, cache, force regeneration,
immutability, and audit, then writes a verification copy to
`%TEMP%\tax-agency-phase8-live.xlsx`. No customer data should be used.

Do not reset the hosted database. Phase 9 work requires a separate instruction.
