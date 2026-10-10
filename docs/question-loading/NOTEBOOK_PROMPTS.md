# NotebookLM prompts: extract the curriculum structure, in small steps

NotebookLM answers only from the sources in the notebook and cites them, so it is the right tool for **exact extraction**. It does badly at two things: questions about the notebook itself ("list every source", "count them") and long answers with many columns. So these prompts are **short, one document at a time, and about content**.

**The one rule that makes it work.** In the Sources panel, **tick only the one document you are working on** and untick all the others. Then ask the short questions below. Use the document's own grade wording (for example "Basic 7" for JHS, "SHS 1" for SHS).

**Save each reply** into a text file (copy the reply, paste into a `.txt`), named like `SS_B7_strand1_structure.txt`, and send me the file names. I check the output against the original PDF before anything enters the system.

If a step says "can't answer", make it smaller: one strand, then one indicator, then one sentence.

---

## Step 1: is this document readable? (per document, two quick questions)

**1a. What is it?**
```
What is this document? Give its title, the organisation that issued it, the subject, the grades it covers and the year, in two sentences.
```

**1b. Does it contain the indicators as text?**
```
Show the first learning indicator listed for Basic 7: its exact code, its exact wording, and the page it is on.
```
If 1b gives a code and wording, the document loaded properly. If it says it cannot find one, the source did not import as curriculum text (for example it is only a web page with links, or scanned images). Note which documents fail and send me the list; I will fetch those PDFs directly.

---

## Step 2: the strands (one short list)

```
List the names of the strands for Basic 7 in this document, in order, with the page where each one starts.
```

---

## Step 3: the structure of one strand (a small table)

Repeat for each strand, changing the number.

```
For Strand 1 of Basic 7, make a table with one row per learning indicator and these columns: indicator code, indicator wording, content standard code, content standard wording, sub-strand name, page. Copy the codes and wording exactly as printed. Do not summarise or change any word.
```

Then ask for the control check:

```
How many learning indicators are in Strand 1 of Basic 7? List all their codes in order, separated by commas.
```

---

## Step 4: the exemplars of that strand (plain lines, easy for me to read)

```
For each learning indicator in Strand 1 of Basic 7, list ALL the exemplars exactly as written in the document. Use one line per indicator in this layout:
INDICATOR <code> | page <number> | 1) <first exemplar> || 2) <second exemplar> || 3) <third exemplar>
Copy the wording word for word. Do not shorten, merge or reword. Do not leave any exemplar out.
```

---

## Step 5 (optional): facts from a textbook or teacher's guide

Use this only when you have added a textbook, teacher's guide or notes. Tick that source (and, if you like, the curriculum too).

```
Using only this source, list the key facts a Basic 7 learner needs about "<topic name>". Give one fact per line, and after each fact give the page it comes from and a short phrase copied word for word from the source.
```
If the source has nothing on the topic it should say so; do not accept answers without page numbers.

---

## What I do with the files
- Check every row against the original PDF: codes exist, wording is verbatim, exemplars are complete, counts match.
- Build the verified curriculum structure and the **topic registry** (tracker T1), and group the indicators into topics with concepts myself, so NotebookLM does only the exact extraction.
- Feed the topic map into the question prompt.

## Order of work
1. Steps 1a and 1b for the **Social Studies Basic 7** document, as a test (I already have that PDF to check against).
2. Step 2, then Steps 3 and 4 for **Strand 1**.
3. Send me those files. I will tell you whether the format is right before you do the other strands and subjects.
