import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || "listening");
const output = path.resolve(process.argv[3] || "dist/listening-data.js");
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

const naturalNumber = value => Number(String(value).match(/\d+/)?.[0] || 0);
const byNumber = (a, b) => naturalNumber(a) - naturalNumber(b);
const stable = value => value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function cleanText(source) {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n")
    .filter(line => !/^\s*SECTION\s+\d+\s*$/i.test(line))
    .filter(line => !/^\s*(Example|Repeat)\s*$/i.test(line))
    .filter(line => !/^\s*-{8,}\s*$/.test(line))
    .join("\n")
    .replace(/\bQ\d+\b/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function toSentences(source, idPrefix) {
  const paragraphs = cleanText(source).split(/\n\s*\n+/).map(p => p.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const items = [];
  for (const paragraph of paragraphs) {
    const segments = [...segmenter.segment(paragraph)].map(item => item.segment.trim()).filter(Boolean);
    for (const text of segments.length ? segments : [paragraph]) {
      if (/^(Example|Repeat)$/i.test(text)) continue;
      items.push({ id: `${idPrefix}_s${items.length + 1}`, text });
    }
  }
  return items;
}

const bookDirs = (await readdir(root, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && /^Cambridge\d+$/i.test(entry.name))
  .sort((a, b) => byNumber(a.name, b.name));

const books = [];
let fileCount = 0;
let sentenceCount = 0;

for (const bookDir of bookDirs) {
  const bookNumber = naturalNumber(bookDir.name);
  const bookPath = path.join(root, bookDir.name);
  const testDirs = (await readdir(bookPath, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^test\d+$/i.test(entry.name))
    .sort((a, b) => byNumber(a.name, b.name));
  const tests = [];

  for (const testDir of testDirs) {
    const testNumber = naturalNumber(testDir.name);
    const testPath = path.join(bookPath, testDir.name);
    const sectionFiles = (await readdir(testPath, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^section\d+\.txt$/i.test(entry.name))
      .sort((a, b) => byNumber(a.name, b.name));
    const sections = [];

    for (const sectionFile of sectionFiles) {
      const sectionNumber = naturalNumber(sectionFile.name);
      const idPrefix = `cam${bookNumber}_t${testNumber}_sec${sectionNumber}`;
      const source = await readFile(path.join(testPath, sectionFile.name), "utf8");
      const sentences = toSentences(source, idPrefix);
      sections.push({ id: idPrefix, title: `Section ${sectionNumber}`, sentences });
      fileCount += 1;
      sentenceCount += sentences.length;
    }

    if (sections.length) tests.push({ id: `cam${bookNumber}_t${testNumber}`, title: `Test ${testNumber}`, sections });
  }

  if (tests.length) books.push({ id: `cambridge_${bookNumber}`, title: `剑桥雅思 ${bookNumber}`, note: `内置听力文本 · ${tests.length} 个 Test`, source: "catalog", tests });
}

await mkdir(path.dirname(output), { recursive: true });
const banner = `// Generated from the local listening library. Do not edit by hand.\n`;
await writeFile(output, `${banner}window.LISTENING_LIBRARY = ${JSON.stringify(books)};\n`, "utf8");
console.log(JSON.stringify({ books: books.length, tests: books.reduce((sum, book) => sum + book.tests.length, 0), files: fileCount, sentences: sentenceCount, output, bytes: Buffer.byteLength(JSON.stringify(books)) }, null, 2));

