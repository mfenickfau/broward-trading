# Instructor Guide — running a class with Broward Trading

How a Broward College instructor (or any teacher, club lead or tutor) runs a section on the free app: create a class code, let students join from their phones, review the roster every week, keep a gradebook that grades process rather than profit, and export grades to a spreadsheet. Nothing here requires IT support, a budget, or student email addresses.

This guide covers the **Classroom** feature (`instructor.html`, "More → Instructor" on a phone). The syllabus, weekly plan and rubrics live in [TEACHING_GUIDE.md](TEACHING_GUIDE.md); this document is about the tooling that collects the evidence those rubrics ask for.

---

## Contents

1. [What Classroom does, in one minute](#1-what-classroom-does-in-one-minute)
2. [Two ways to run it: share codes or the classroom server](#2-two-ways-to-run-it-share-codes-or-the-classroom-server)
3. [Before Week 1: create your class code](#3-before-week-1-create-your-class-code)
4. [Week 1 in class: students join](#4-week-1-in-class-students-join)
5. [The weekly review of the roster](#5-the-weekly-review-of-the-roster)
6. [Reading one student](#6-reading-one-student)
7. [The gradebook and its weights](#7-the-gradebook-and-its-weights)
8. [Exporting grades to a spreadsheet](#8-exporting-grades-to-a-spreadsheet)
9. [Backups, second devices and the end of term](#9-backups-second-devices-and-the-end-of-term)
10. [Privacy: what is collected, what is not, and what to tell students](#10-privacy-what-is-collected-what-is-not-and-what-to-tell-students)
11. [Troubleshooting](#11-troubleshooting)
12. [Appendix: what a snapshot contains](#appendix-what-a-snapshot-contains)

---

## 1. What Classroom does, in one minute

Every student's work already lives on their own phone: lessons marked done, quiz scores, Market Replay drill scorecards, the paper account, the journal, the Daily 5 streak. Classroom packages those numbers into a small **snapshot** and gets it to you, so that instead of collecting three files per student per week you open one page and see the whole section:

| Column | Where it comes from | What it tells you |
|---|---|---|
| Progress | `Learn` lessons marked done out of the course total | Who is keeping up with the reading |
| Quiz avg | Best score per lesson quiz | Comprehension; retakes never lower it |
| Drills | Replay drill scorecards, best attempt per drill | Whether the rule-following practice is happening; how many of the required drills passed |
| Paper return | Main paper account | Conversation only. Never graded, never ranked. |
| Journal | Entry count, how many have setup + emotion, weekly reviews saved | Whether reflection is happening (the text itself stays on the phone) |
| Daily 5 | Current streak and days played | Vocabulary habit; the participation proxy |
| Last active | Newest date across all of the above | Who has gone quiet |

Students are **pseudonymous**. The app invents a random id such as `s-k3m9p2x7qa` on each phone; the student may type a first name or nickname so you can tell rows apart, and that is all the identity there is. See section 10.

## 2. Two ways to run it: share codes or the classroom server

Classroom works in two modes, and you do not have to decide up front; the page detects which one applies.

**Share codes (no server, works for everyone today).** Each week the student opens `Learn → Classroom` and taps **Copy share code**. A share code is a single line of text starting with `BT1.` (their whole snapshot, compressed; usually 400 to 900 characters). They paste it into whatever you already use: the LMS assignment box, an email, a message. You paste all of them at once into **Import share codes** on the instructor page. Nothing leaves the student's phone until they copy it, and nothing is stored anywhere except your browser.

**Classroom server (optional).** If your school has deployed the optional backend from `server/` (see [MEMBERSHIP_SETUP.md](MEMBERSHIP_SETUP.md); it is a free-tier Cloudflare Worker), students' phones send the snapshot automatically: right after each finished lesson or quiz, and otherwise at most every five minutes while the app is open. You tap **Refresh from server** and the roster updates. The page shows `server: connected` in its header pill when this is available; otherwise it shows `offline: share codes`.

Both modes feed the same roster, drawer, gradebook and exports. A class can start on share codes and switch to the server later, or mix the two (a student whose phone was offline can always hand you a share code).

## 3. Before Week 1: create your class code

About five minutes, on any device.

1. Open the site and go to **More → Instructor** (`instructor.html`).
2. Under **Your class**, enter a class name students will recognise ("FIN 1100 — Markets by Doing"), optionally a section ("Tue 6 pm · Central") and a term. If the server is connected you also see a checkbox **Sync with the classroom server**; leave it on unless you specifically want an offline class.
3. Tap **Create class and get a code**. You get a six-character code like `K7Q2MX`. Codes never contain `0`, `O`, `1` or `I`, so they can be read aloud without confusion.
4. Tap **Copy invitation text** and paste it into your syllabus, LMS announcement and first slide. It says exactly what students need to do.

If the server asks you to sign in: class creation on the server needs either a signed-in account (the magic-link sign-in under **More → Pro**) or the school's **instructor secret**, which whoever deployed the Worker can give teaching staff. Paste the secret once under *Instructor secret* on the page; it is stored only in that browser. If neither is available, untick the sync box: an offline class works identically with share codes.

Create one class per section. The class picker at the top switches between them; the roster, gradebook and exports always refer to the active class.

**Do this now, not later:** open **Export & backup → Backup JSON**, copy the text and keep it in your drive. For a synced class it contains the instructor key that lets this browser read the roster; if the browser's site data is cleared, the backup is how you get it back (section 9).

## 4. Week 1 in class: students join

Add this to the Week 1 setup block in the Teaching Guide (it takes about three minutes):

1. Students open **Learn** on their phone and scroll to the **Classroom** card.
2. They type the class code and, if they like, a first name or nickname. Tell them what you want here: a first name and last initial is usually right. Nothing else is asked.
3. **With the server:** that is it; their snapshot is sent as soon as they finish anything. **Without it:** show them **Copy share code** and where to paste it (your LMS assignment is best, because it timestamps the submission). Ask for a code at the end of every week, with the Friday progress export the syllabus already requires.

Students who join late do the same thing in their own time. A student who switches phones gets a new random id; the old row stays until you remove it, and you can label both with the same name.

Ask students to read the Classroom card's privacy line. It says what section 10 says, in two sentences.

## 5. The weekly review of the roster

Ten minutes every Friday or before class. The roster is sortable by any column: tap a heading once for descending, again for ascending.

1. **Import or refresh.** Paste the week's share codes into **Import share codes** and tap Import (the box accepts an entire email thread; it finds every `BT1.` code in it and ignores the rest), or tap **Refresh from server**. The message tells you how many were new, updated or older than what you already had (an old code never overwrites a newer snapshot).
2. **Sort by Last active.** Anyone with a yellow edge has had no activity for more than a week. That is your early-alert list; a message on Monday beats a failing grade in Week 6.
3. **Sort by Progress.** Compare with the week's reading in the Teaching Guide (Modules 1 and 2 by Week 1, Module 3 by Week 2, and so on). The number under the percentage is lessons done out of the course total.
4. **Sort by Quiz avg.** Below 80 % is below the certificate threshold; students may retake quizzes and the app keeps the best score. Open the student (section 6) to see which module is dragging the average.
5. **Sort by Drills** in the weeks that assign them (from Week 2). The small text shows how many of the *required* drills have passed; the big number counts all passed drills.
6. **Glance at Journal.** The first number is entries; the small text says how many are reviewed (setup and emotion filled in) and how many weekly reviews were saved. From Week 3 the journal is graded; low "reviewed" counts are the usual reason a journal week scores poorly.
7. **Do not sort by Paper return** for anything other than a discussion prompt ("why is the top return paired with the deepest drawdown?"). The syllabus grades process, and students know it.

Everything in the roster is evidence of work, not proof: a progress file is editable text, and the Teaching Guide's academic-honesty section applies. Pair it with in-class exercises and the peer-reviewed capstone, where the evidence must match the journal.

## 6. Reading one student

Tap a row to open the student drawer.

- **Your label.** Rename the row however helps you (first name, seat number). The label is stored only in your browser and never sent anywhere.
- **Tiles.** Progress, quiz average, drills passed (and how many of the required ones), paper return (with the reminder that it is never graded), journal counts, Daily 5.
- **Modules.** Lessons done and quiz average per module. This is where you see that a 72 % average is a strong student who bombed Module 5, which is a different conversation from a student at 72 % everywhere.
- **Replay drills.** Best attempt per drill with pass / finished / started, return, max drawdown and date. Required drills are marked. "Finished" with criteria failed is the 3-point band in the Teaching Guide's drill rubric; "started" is the 1-point band.
- **Grade sheet.** The six components with their automatic score shown as a placeholder. Type a number to override one; clear the box to go back to automatic. Forward test and capstone have no automatic score and always need your number. A private note field sits underneath (capstone feedback, accommodations).
- **Remove from class.** Deletes the student from this device and, for a synced class, from the server; the student's phone is told to stop sending and leaves the class on its next attempt. Use it when a student drops or asks to be removed.

## 7. The gradebook and its weights

The gradebook applies the Teaching Guide's suggested 100-point split and lets you change it:

| Component | Default weight | How the automatic score is computed | Your job |
|---|---|---|---|
| Lesson quizzes | 20 | Sum of best quiz scores over **every** lesson in the course, so an untaken quiz counts as zero (the roster's "quiz avg" averages only the quizzes taken; the gradebook is stricter on purpose) | Nothing, unless you excuse a module |
| Replay drills | 20 | Per required drill: all criteria passed = 1, finished with a scorecard but some criteria failed = 0.6, started = 0.2; summed and divided by the number required (6 by default) | Edit the required drill ids or the count under the weights if your section assigns different drills |
| Journal | 20 | A completeness proxy: half from the share of entries that have a setup and an emotion, half from weekly reviews saved (four expected) | The reflection half of the rubric needs a human. Read the student's journal export for the graded weeks and override the number |
| Forward test | 10 | None | From the Week 5–6 journal export: share of trades tagged `followed-plan`, a stop on every trade, risk within the plan. Enter points |
| Capstone plan | 25 | None | The written trading plan, rubric in TEACHING_GUIDE.md §8. Enter points |
| Participation | 5 | Daily 5 days completed, 30 days = full marks | Override with your attendance / in-class record if you keep one |

Weights are edited in the number boxes; the page tells you when they no longer add up to 100 (that is allowed, percentages are computed from the actual total). **Reset to guide defaults** restores the table above and the default drill list.

Letters follow the guide: A 90+, B 80–89, C 70–79, D 60–69, F below. A letter marked with `*` is incomplete: at least one component has no number yet, which is the normal state until you have graded the capstone. The gradebook table colours a number blue when you entered it and shows a dash for a manual component still waiting on you.

A fair warning about proxies: the automatic journal and participation scores are starting points that save you arithmetic, not judgements. A student who writes one excellent lesson a week will be under-scored by "entries reviewed"; a student who ticks boxes will be over-scored. Override freely; the export records which numbers were automatic and which were yours.

## 8. Exporting grades to a spreadsheet

Open **Export & backup**.

- **Roster CSV**: one row per student with plain column names (`name, student_id, progress_pct, lessons_done, lessons_total, quiz_avg_pct, quizzes_taken, drills_passed, drills_required_passed, drills_attempted, paper_return_pct, paper_trades, paper_win_rate_pct, journal_entries, journal_reviewed, weekly_reviews, daily5_streak, daily5_days, certificate_id, last_active, snapshot_at`). Good for the weekly check-in and for merging with your attendance sheet.
- **Gradebook CSV**: name, id, points per component (the header shows each maximum, e.g. `capstone_pts (/25)`), a `_source` column per component saying `auto`, `manual` or `missing`, then total, max, percentage, letter (with `(incomplete)` where a component is missing) and your private note.

Getting it into a spreadsheet, from a phone or a laptop:

1. Tap the export button; the text appears in the box. Tap **Copy**.
2. **Google Sheets:** paste into cell A1. If everything lands in one column, select column A and use *Data → Split text to columns* (choose comma). **Excel:** paste, then *Data → Text to Columns → Delimited → Comma*. **Numbers** on iPhone/iPad: paste into a cell and it splits automatically.
3. Or tap **Download file** to save a `.csv` named after the class code and open it directly. Some school-managed browsers block downloads; the copy route always works.

Then match rows to your LMS roster using the name label you gave each student (section 6). Keep the `student_id` column in the sheet: it is how you reconcile a student who re-joined from a new phone.

Nicknames that start with `=`, `+`, `-` or `@` are quoted in the CSV so they cannot run as a formula in your spreadsheet.

## 9. Backups, second devices and the end of term

Everything on the instructor page lives in the browser you used (`localStorage` key `bt.instructor`). That means:

- **Back up** with **Export & backup → Backup JSON** at least after Week 1 and before final grades. The file holds classes, snapshots, your labels, manual grades and notes; for a synced class it also holds the instructor key, so treat it like a grade sheet and keep it in your institution's drive, not in email.
- **Second device:** paste the backup into **Restore a backup JSON** on the other device. Restoring merges: existing classes keep their newer snapshots and your manual grades.
- **Cleared site data / new browser:** restore from the backup. Without one, a synced class can still be read with your sign-in session (if you created it signed in) or the instructor secret; an offline class is gone, so students would re-send share codes.
- **End of term:** export the gradebook CSV and a final backup, then **Delete this class from this device**. On the server, snapshots expire by themselves after 400 days; your IT staff can delete a class earlier (see `server/README.md`).

## 10. Privacy: what is collected, what is not, and what to tell students

Classroom was designed around data minimisation, with FERPA in mind: collect the least that lets you grade, keep it where you already keep grades, and never create a second student directory.

**Collected (in the snapshot):** a random id generated on the student's phone; the optional name they typed; lesson ids done; quiz percentages; drill scorecards (drill id, pass/fail, return, drawdown, date); paper-account statistics (equity, return, number of trades, win rate); journal *counts* (entries, how many reviewed, weekly reviews, last entry date); Daily 5 counts; timestamps.

**Not collected, ever:** email address, real name, phone number, student number, IP address, device or browser details, location, the journal text, the list of trades, anything typed into a lesson. The classroom server stores exactly the whitelisted fields above and discards anything else; it does not log who sent a snapshot.

**Where it lives:** in your browser; and, with the server, in your school's own Cloudflare account (not with the project maintainers), for at most 400 days, deletable per student from the drawer and per class by your IT staff.

**What to tell students (say it in Week 1 and put it in the syllabus):**

> The app sends me your course statistics: lessons done, quiz scores, drill results, how much you journal, your paper-trading numbers. It does not send your email, your name unless you type one, your journal text, or your trades. I use it to see who is keeping up and to grade quizzes, drills and journal completeness; your paper-trading profit is never graded. You can leave the class at any time from the Classroom card, and you can ask me to delete your record.

**Your obligations do not change:** the roster, exports and backups are education records once you attach a name you can identify. Keep them in the LMS or institutional storage, do not email them, and do not share a class code or an instructor backup outside the teaching team. If you want students to be identifiable only to you, ask for a seat number instead of a name.

## 11. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "No share code found" | The paste did not include the `BT1.` prefix, or the code was wrapped and broken by an email client | Ask for the code pasted as plain text; the importer tolerates line breaks only around a code, not inside it |
| "That share code is damaged or incomplete" | A character was lost in copy-and-paste | Ask the student to copy it again (long-press the box on the Classroom card selects all of it) |
| "This share code is compressed and this browser cannot decompress it" | A very old browser without `DecompressionStream` on the instructor side | Open the instructor page in a current Chrome, Edge, Safari or Firefox; the student's code is fine |
| A student appears twice | They switched phones or cleared site data, so the app made a new id | Label both rows with the same name; remove the old one once you have its grades |
| "Older than what you have (kept yours)" | The student sent last week's code again | Harmless; nothing changed |
| Roster refresh says `403` | This browser has no instructor key for the class and you are not signed in as its creator | Restore your backup JSON here, sign in with the account that created the class, or save the instructor secret under *Your class* |
| Students' snapshots never arrive on a synced class | Their phones were offline, or `js/config.js` on the site has no `apiBase` | Ask for a share code meanwhile; check the header pill says `server: connected` |
| Grade shows `F*` | A manual component (capstone, forward test) has no number yet | Expected until you grade it; the `*` disappears once every component has points |

## Appendix: what a snapshot contains

For the curious and for IT review. A snapshot is the JSON object produced by `BT.classroom.snapshot()`; a share code is `BT1.` followed by that JSON, deflated (`deflate-raw`) when the browser supports it, base64url-encoded. The classroom server re-validates every field (`sanitizeSnapshot` in `server/worker.js`), clamps numbers and drops anything not listed here.

```json
{
  "v": 1,
  "studentId": "s-k3m9p2x7qa",
  "displayName": "Ada L.",
  "classCode": "K7Q2MX",
  "lessonsDone": ["m1-l1", "m1-l2", "m2-l1"],
  "quizScores": { "m1-l1": 80, "m1-l2": 100, "m2-l1": 60 },
  "lessonsTotal": 45,
  "startedAt": "2027-01-12T18:04:00.000Z",
  "certificate": null,
  "drills": [{ "id": "ride-the-trend-nvda-2023", "title": "Ride the trend: NVDA 2023", "returnPct": 25.1, "buyHoldPct": 30.2, "maxDrawdownPct": 6, "trades": 3, "passed": true, "completed": true, "date": "2027-02-02" }],
  "paper": { "equity": 101234.5, "startingCash": 100000, "returnPct": 1.23, "trades": 3, "winRate": 66.7, "fills": 4, "positions": 1 },
  "journalEntries": 3,
  "journal": { "entries": 3, "reviewed": 2, "withLessons": 1, "weeklyReviews": 2, "lastDate": "2027-02-05" },
  "streak": 3,
  "daily": { "streak": 3, "days": 4, "best": 3 },
  "lastActive": "2027-02-06",
  "updatedAt": "2027-02-06T21:10:33.000Z"
}
```

Tests covering the round-trip of share codes, the roster maths, the gradebook and the server routes are in `tests/classroom.test.js`.
