# Western starter question banks

The project owner supplied these two AI-generated lecture practice banks and requested publication, stating they had reviewed the questions:

- BIOCHEM 2280A — Biochemistry and Molecular Biology: 150 questions, 3 units, 23 topics.
- CHEM 2213A — Organic Chemistry for Life Sciences: 150 questions, 10 lecture modules. No lab questions.

The app imports these files into SQLite on first database use. Repeated starts skip existing items, including questions later withdrawn by moderators. Content changes require a deliberate revision; a deployment cannot silently overwrite existing questions.

The bundled files omit `sourceEvidence`. Original files and the source coverage report stay outside the public repository. To retain their evidence in the server's private import table, run:

```sh
npm run db:import-questions -- --dry-run /private/path/biochem-2280a-150-questions.json /private/path/chem-2213a-150-questions.json
npm run db:import-questions -- /private/path/biochem-2280a-150-questions.json /private/path/chem-2213a-150-questions.json
```

Use the same `DATABASE_PATH` as the app. The importer preserves answer keys, explanations, generation dates, difficulty labels, and source descriptions. It records the owner's review statement separately from independent student review. The public interface has no review labels or filters.

The source report says several originally listed files and all lecture transcripts were unavailable to the authoring chat. Its source-page checks cannot be independently confirmed from the question JSON alone. Source evidence is excluded from public API payloads.

The application code license does not assign a content license to these owner-supplied banks. The project's content-license decision remains documented in `docs/CONTENT-LICENSE.md`.
