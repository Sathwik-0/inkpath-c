# Inkpath foundation (v2)

**One sentence:** a serialised original novel generated from your material, where a learner model decides what each chapter must teach, review and pay off, and recall checks decide what comes back.

The model is the writer. The database is the brain.

## Pipeline

1. **Analyze** (`stageAnalyze`): source or topic -> concept graph (`concepts`, `concept_edges`), each concept with common misconceptions.
2. **Bible** (`stageBible`): one-time world design. Every concept becomes a world rule (`concepts.world_rule`). Stored in `story_bibles`, reused by every chapter. Chapter outline rows are created.
3. **Plan** (`planChapter`, code): picks new concepts (dependency order, even pacing), due reviews (most lapsed first), threads due for payoff, one concept to plant, and craft cards. No AI.
4. **Write** (`stageChapter`): chapter prose from bible + rolling summary + brief.
5. **Verify**: a second pass checks accuracy and that every new concept is acted on, not explained. One revision, then ship and flag `verified=false` with notes.
6. **Recall** (`recordRecall`): story-set questions, graded on the server. Answers feed the scheduler.
7. **System window**: a view over `learner_concepts.level`, which rises only with longer successful recall gaps.

## Data

| Table | Purpose |
|---|---|
| concepts, concept_edges | the concept graph |
| story_bibles | world, rules, cast, voice, rolling summary |
| story_threads | Chekhov ledger: planted setups and payoffs |
| craft_cards | abstract techniques the planner picks from |
| chapters | `prose`, `hook`, `brief`, `verified` |
| learner_concepts | per-learner memory state and level |
| review_events | append-only log of every recall answer |
| quizzes, quiz_attempts | chapter-end recall |

Clients can read their own rows; all writes to story memory and the learner model go through the server with the service role.

## Rules the code enforces

- The funding source for a job is decided once; never switched silently.
- Free tier is 3 chapters per account, reserved atomically.
- Correct answers never leave the server before grading.
- Source text is wrapped as untrusted data in every prompt.
- Craft is abstract technique only; stories use invented names and worlds.

## Known limits

- Long-serial consistency depends on the bible and rolling summary; test with a 6+ chapter story.
- The verifier reduces, but does not eliminate, wrong statements.
- Spaced-repetition constants are sensible defaults, not tuned on real learners yet.
- Image panels are a later renderer over the same prose.
