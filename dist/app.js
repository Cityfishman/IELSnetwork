const STORE_KEY = "listenfolio-v1";
const today = () => new Date().toISOString().slice(0, 10);
const uid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const sampleSentences = [
  "Good morning, Westbridge Community Centre. How can I help you?",
  "I'm calling to ask about the weekend photography course advertised on your website.",
  "Certainly. The next course begins on the twelfth of October and runs for four consecutive Saturdays.",
  "Each session starts at half past nine and finishes just before lunchtime.",
  "Participants should bring their own camera, although professional equipment is not required.",
  "The tutor will begin with composition and natural light before moving on to portrait photography.",
  "There is also a short outdoor assignment in the final week.",
  "The standard fee is ninety pounds, but students receive a fifteen percent discount.",
  "You will need to complete the online registration form by Friday.",
  "Please note that the course is limited to twelve participants, so early booking is recommended.",
  "A confirmation email will be sent within two working days.",
  "If you have any accessibility requirements, you can add them to the notes section of the form.",
  "The centre is opposite the public library and can be reached by bus number twenty-six.",
  "Parking is available behind the building, but spaces are quite limited.",
  "Would you like me to reserve a place while you complete the form?"
];

function freshState() {
  const sectionId = "section_demo_1";
  const testId = "test_demo_1";
  const bookId = "book_demo";
  return {
    version: 1,
    books: [{
      id: bookId,
      title: "我的练习册",
      note: "示例材料，可随时删除或继续添加",
      tests: [{
        id: testId,
        title: "Test 1",
        sections: [{ id: sectionId, title: "Section 1", sentences: sampleSentences.map((text, i) => ({ id: `demo_s_${i + 1}`, text })) }]
      }]
    }],
    annotations: [],
    progress: { [testId]: { sectionId, page: 0, updatedAt: new Date().toISOString() } },
    settings: { pageSize: 8, fontScale: 1, dark: false, hideMastered: false },
    activity: []
  };
}

let state = loadState();
let view = "dashboard";
let reader = { bookId: state.books[0]?.id, testId: state.books[0]?.tests[0]?.id, sectionId: state.books[0]?.tests[0]?.sections[0]?.id, page: 0 };
let review = { kind: "all", index: 0, revealed: false };
let modal = null;
let selectedText = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved?.version === 1 && Array.isArray(saved.books)) return saved;
  } catch (_) {}
  return freshState();
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function findContext(bookId = reader.bookId, testId = reader.testId, sectionId = reader.sectionId) {
  const book = state.books.find(b => b.id === bookId) || state.books[0];
  const test = book?.tests.find(t => t.id === testId) || book?.tests[0];
  const section = test?.sections.find(s => s.id === sectionId) || test?.sections[0];
  return { book, test, section };
}

function annotationSource(a) {
  const { book, test, section } = findContext(a.bookId, a.testId, a.sectionId);
  return [book?.title, test?.title, section?.title].filter(Boolean).join(" · ");
}

function dueAnnotations() {
  return state.annotations.filter(a => a.status !== "mastered" && (!a.nextReview || a.nextReview <= today()));
}

function lastProgress() {
  const entries = Object.entries(state.progress || {}).sort((a, b) => (b[1].updatedAt || "").localeCompare(a[1].updatedAt || ""));
  if (!entries.length) return findContext();
  const [testId, progress] = entries[0];
  for (const book of state.books) {
    const test = book.tests.find(t => t.id === testId);
    if (test) return { book, test, section: test.sections.find(s => s.id === progress.sectionId) || test.sections[0], page: progress.page || 0 };
  }
  return findContext();
}

const navItems = [
  ["dashboard", "⌂", "学习首页"],
  ["library", "▤", "资料库"],
  ["reader", "◫", "精读模式"],
  ["review", "↻", "复习中心"],
  ["annotations", "✦", "标注本"],
  ["settings", "⚙", "设置"]
];

function shell(content, crumb = "学习首页", readerClass = "") {
  return `
    <div class="shell ${readerClass}">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="brand-mark">聆</div><div><strong>听力精读本</strong><small>Listenfolio</small></div></div>
        <nav class="nav">${navItems.map(([id, icon, label]) => `<button class="nav-btn ${view === id ? "active" : ""}" onclick="go('${id}')"><span class="nav-icon">${icon}</span>${label}</button>`).join("")}</nav>
        <div class="side-foot">所有学习数据保存在当前浏览器。<br>建议定期导出备份。</div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div style="display:flex;align-items:center;gap:12px"><button class="btn icon mobile-menu" onclick="toggleMenu()">☰</button><span class="crumb">${esc(crumb)}</span></div>
          <div class="top-actions"><label class="search">⌕ <input placeholder="搜索单词、句子或笔记" onkeydown="if(event.key==='Enter') searchAll(this.value)" /></label><button class="btn icon" title="切换深色模式" onclick="toggleDark()">◐</button></div>
        </header>
        ${content}
      </main>
    </div>
    ${modal ? renderModal() : ""}`;
}

function render() {
  document.body.classList.toggle("dark", !!state.settings.dark);
  let html;
  if (view === "dashboard") html = dashboard();
  else if (view === "library") html = library();
  else if (view === "reader") html = readerView();
  else if (view === "review") html = reviewView();
  else if (view === "annotations") html = annotationsView();
  else if (view === "settings") html = settingsView();
  else if (view === "search") html = searchView();
  document.getElementById("app").innerHTML = html;
}

function dashboard() {
  const words = state.annotations.filter(a => a.kind === "word");
  const sentences = state.annotations.filter(a => a.kind === "sentence");
  const due = dueAnnotations();
  const mastered = state.annotations.filter(a => a.status === "mastered").length;
  const last = lastProgress();
  const bookCount = state.books.length;
  const testCount = state.books.reduce((n, b) => n + b.tests.length, 0);
  return shell(`<div class="content">
    <section class="hero"><div><div class="eyebrow">Personal listening workspace</div><h1>把听不懂的，<br>变成真正掌握的。</h1><p class="lede">从文本精读开始，把每个问题词和问题句带进复习循环。今天继续一点点。</p></div><div class="date-stamp">${new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}</div></section>
    <section class="grid stats">
      ${statCard("问题单词", words.length, "累计标注", Math.min(words.length, 100))}
      ${statCard("问题句子", sentences.length, "累计标注", Math.min(sentences.length * 2, 100))}
      ${statCard("今日待复习", due.length, due.length ? "现在开始，约需几分钟" : "今日任务已完成", due.length ? 70 : 100)}
      ${statCard("已经掌握", mastered, state.annotations.length ? `${Math.round(mastered / state.annotations.length * 100)}% 的标注` : "还没有复习记录", state.annotations.length ? mastered / state.annotations.length * 100 : 0)}
    </section>
    <section class="grid two-col">
      <article class="card continue-card"><div class="eyebrow">Continue reading</div><h2 class="continue-title">${esc(last.book?.title || "创建第一份材料")}</h2><p>${last.test ? `${esc(last.test.title)} · ${esc(last.section?.title || "")} · 第 ${(last.page || 0) + 1} 页` : "导入你的第一篇听力文本，开始精读。"}</p><button class="btn dark" onclick="continueReading()">继续精读 <span>→</span></button></article>
      <article class="card card-pad"><div class="eyebrow">Today</div><h2>今日复习</h2><div class="list">${due.slice(0, 3).map(a => `<div class="list-row"><div><div class="row-title">${esc(a.text)}</div><div class="row-meta">${esc(a.type)} · ${esc(annotationSource(a))}</div></div><span class="tag ${a.kind}">${a.kind === "word" ? "单词" : "句子"}</span></div>`).join("") || `<div class="empty">暂时没有待复习内容。</div>`}</div><button class="btn primary" onclick="go('review')" ${due.length ? "" : "disabled"}>开始复习 ${due.length ? `· ${due.length}` : ""}</button></article>
    </section>
    <div class="section-kicker"><h2>资料概览</h2><button class="btn ghost small" onclick="go('library')">查看全部 →</button></div>
    <div class="card card-pad"><div class="list"><div class="list-row"><div><div class="row-title">${bookCount} 本资料 · ${testCount} 个 Test</div><div class="row-meta">内容仅保存在你的浏览器，不会公开展示</div></div><button class="btn small" onclick="openImport()">＋ 导入文本</button></div></div></div>
  </div>`);
}

function statCard(label, number, foot, pct) {
  return `<article class="card stat-card"><span class="stat-label">${label}</span><div><div class="stat-number">${number}</div><div class="stat-foot">${foot}</div><div class="progress"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div></div></article>`;
}

function library() {
  return shell(`<div class="content"><section class="hero"><div><div class="eyebrow">Library</div><h1>听力资料库</h1><p class="lede">按练习册、Test 和 Section 管理文本。第一版建议导入你合法拥有的材料，仅供个人学习。</p></div><button class="btn primary" onclick="openImport()">＋ 导入新文本</button></section>
    <div class="grid library-grid">${state.books.map((b, i) => {
      const testCount = b.tests.length;
      const annoCount = state.annotations.filter(a => a.bookId === b.id).length;
      return `<article class="card book" onclick="openBook('${b.id}')"><div class="book-index">BOOK ${String(i + 1).padStart(2, "0")}</div><h3>${esc(b.title)}</h3><div class="book-meta">${testCount} 个 Test · ${annoCount} 条标注</div><div class="book-bottom"><div class="progress"><i style="width:${Math.min(100, annoCount * 4)}%"></i></div><div class="row-meta" style="margin-top:10px">${esc(b.note || "个人听力材料")}</div></div></article>`;
    }).join("")}<button class="card book add-card" onclick="openImport()"><div class="plus">＋</div><strong>添加听力文本</strong><span class="row-meta">粘贴英文内容，自动切分句子</span></button></div>
  </div>`, "资料库");
}

function openBook(bookId) {
  const book = state.books.find(b => b.id === bookId);
  const test = book?.tests[0]; const section = test?.sections[0];
  if (!test || !section) return;
  reader = { bookId, testId: test.id, sectionId: section.id, page: state.progress[test.id]?.page || 0 };
  go("reader");
}

function readerView() {
  const { book, test, section } = findContext();
  if (!section) return shell(`<div class="content"><div class="empty">资料库中还没有文本。<br><button class="btn primary" onclick="openImport()">导入文本</button></div></div>`, "精读模式", "reader-page");
  reader.bookId = book.id; reader.testId = test.id; reader.sectionId = section.id;
  const pages = Math.max(1, Math.ceil(section.sentences.length / state.settings.pageSize));
  reader.page = Math.max(0, Math.min(reader.page, pages - 1));
  const start = reader.page * state.settings.pageSize;
  const sentences = section.sentences.slice(start, start + state.settings.pageSize);
  const sectionAnnotations = state.annotations.filter(a => a.sectionId === section.id && (!state.settings.hideMastered || a.status !== "mastered"));
  return shell(`<div class="content">
    <div class="reader-toolbar">
      <select class="input" style="width:auto" onchange="switchBook(this.value)">${state.books.map(b => `<option value="${b.id}" ${b.id === book.id ? "selected" : ""}>${esc(b.title)}</option>`).join("")}</select>
      <select class="input" style="width:auto" onchange="switchTest(this.value)">${book.tests.map(t => `<option value="${t.id}" ${t.id === test.id ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</select>
      <span class="tag">选中文字即可标注</span>
      <button class="btn small" onclick="changeFont(-.1)">A−</button><button class="btn small" onclick="changeFont(.1)">A＋</button>
    </div>
    <div class="reader-layout">
      <aside class="card reader-outline"><div class="outline-label">SECTIONS</div>${test.sections.map(s => `<button class="section-btn ${s.id === section.id ? "active" : ""}" onclick="switchSection('${s.id}')">${esc(s.title)}</button>`).join("")}</aside>
      <article class="reader-paper" style="--font-scale:${state.settings.fontScale}">
        <div class="reader-head"><div><div class="eyebrow">${esc(book.title)} · ${esc(test.title)}</div><h2>${esc(section.title)}</h2></div><span class="page-indicator">PAGE ${reader.page + 1} / ${pages}</span></div>
        <div class="transcript" onmouseup="handleSelection(event)">${sentences.map((s, i) => sentenceHtml(s, start + i, sectionAnnotations)).join("")}</div>
        <div class="reader-foot"><button class="btn" onclick="pageReader(-1)" ${reader.page === 0 ? "disabled" : ""}>← 上一页</button><span class="page-indicator">${start + 1}—${Math.min(start + state.settings.pageSize, section.sentences.length)} / ${section.sentences.length} 句</span><button class="btn primary" onclick="pageReader(1)" ${reader.page >= pages - 1 ? "disabled" : ""}>下一页 →</button></div>
      </article>
      <aside class="card annotation-panel"><div class="eyebrow">On this section</div><h3>本节标注 · ${sectionAnnotations.length}</h3>${sectionAnnotations.slice().reverse().map(a => `<div class="anno-item" onclick="editAnnotation('${a.id}')"><span class="tag ${a.kind}">${a.kind === "word" ? "单词" : "句子"}</span><q>${esc(a.text)}</q><div class="row-meta">${esc(a.type)}${a.note ? ` · ${esc(a.note)}` : ""}</div></div>`).join("") || `<div class="empty">选择单词或点击句子右侧标记按钮，开始记录问题。</div>`}</aside>
    </div>
  </div>`, `${book.title} / ${test.title} / ${section.title}`, "reader-page");
}

function sentenceHtml(sentence, index, annotations) {
  const sentenceMarked = annotations.some(a => a.kind === "sentence" && a.sentenceId === sentence.id);
  const wordAnnos = annotations.filter(a => a.kind === "word" && a.sentenceId === sentence.id).map(a => a.text.toLowerCase());
  const tokens = sentence.text.split(/(\b[A-Za-z][A-Za-z'’-]*\b)/g).map(part => {
    if (/^[A-Za-z][A-Za-z'’-]*$/.test(part)) return `<span class="word ${wordAnnos.includes(part.toLowerCase()) ? "annotated" : ""}" data-word="${esc(part)}" ondblclick="quickWord(event,'${sentence.id}',this.dataset.word)">${esc(part)}</span>`;
    return esc(part);
  }).join("");
  return `<p class="sentence ${sentenceMarked ? "marked" : ""}" data-sentence-id="${sentence.id}" style="font-size:calc(18px * ${state.settings.fontScale})"><span class="sentence-num">${index + 1}</span>${tokens}<button class="mark-sentence" title="标记整句" onclick="quickSentence(event,'${sentence.id}')">◆</button></p>`;
}

function handleSelection(event) {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!text || text.length > 400) return closeSelectionMenu();
  const node = selection.anchorNode?.parentElement;
  const sentenceEl = node?.closest?.(".sentence");
  if (!sentenceEl) return;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  selectedText = { text, sentenceId: sentenceEl.dataset.sentenceId };
  closeSelectionMenu();
  const menu = document.createElement("div");
  menu.id = "selection-menu"; menu.className = "selection-menu";
  menu.style.left = `${rect.left + rect.width / 2}px`; menu.style.top = `${rect.top - 8}px`;
  menu.innerHTML = `<button onclick="annotateSelected('word')">标记单词/短语</button><button onclick="annotateSelected('sentence')">标记句子</button>`;
  document.body.appendChild(menu);
  event.stopPropagation();
}

function closeSelectionMenu() { document.getElementById("selection-menu")?.remove(); }
function annotateSelected(kind) { if (!selectedText) return; openAnnotation(kind, selectedText.text, selectedText.sentenceId); closeSelectionMenu(); window.getSelection()?.removeAllRanges(); }
function quickWord(e, sentenceId, word) { e.stopPropagation(); openAnnotation("word", word, sentenceId); }
function quickSentence(e, sentenceId) { e.stopPropagation(); const { section } = findContext(); const sentence = section.sentences.find(s => s.id === sentenceId); openAnnotation("sentence", sentence.text, sentenceId); }

function openAnnotation(kind, text, sentenceId) {
  const existing = state.annotations.find(a => a.kind === kind && a.sentenceId === sentenceId && a.text.toLowerCase() === text.toLowerCase());
  if (existing) return editAnnotation(existing.id);
  modal = { type: "annotation", kind, text, sentenceId };
  render();
}

function editAnnotation(id) { modal = { type: "annotation", editingId: id }; render(); }

function libraryTestsCount() { return state.books.reduce((n, b) => n + b.tests.length, 0); }

function annotationsView(query = "") {
  const q = query.toLowerCase();
  const list = state.annotations.filter(a => (!q || `${a.text} ${a.note || ""} ${a.type}`.toLowerCase().includes(q)) && (!state.settings.hideMastered || a.status !== "mastered"));
  return shell(`<div class="content"><section class="hero"><div><div class="eyebrow">Annotations</div><h1>我的标注本</h1><p class="lede">所有问题词和问题句都汇集在这里。点击任意标注可编辑笔记和掌握状态。</p></div><span class="date-stamp">${list.length} 条记录</span></section>
    <div class="filter-bar"><button class="filter active">全部 ${list.length}</button><button class="filter" onclick="filterAnnotations('word')">单词 ${list.filter(a => a.kind === 'word').length}</button><button class="filter" onclick="filterAnnotations('sentence')">句子 ${list.filter(a => a.kind === 'sentence').length}</button></div>
    <div class="card card-pad"><div class="list">${list.slice().reverse().map(a => `<div class="list-row"><div><div style="display:flex;gap:8px;margin-bottom:7px"><span class="tag ${a.kind}">${a.kind === "word" ? "单词" : "句子"}</span><span class="tag">${esc(a.type)}</span><span class="tag ${a.status === "mastered" ? "" : "due"}">${statusLabel(a.status)}</span></div><div class="row-title">${esc(a.text)}</div><div class="row-meta">${esc(annotationSource(a))}${a.note ? ` · ${esc(a.note)}` : ""}</div></div><button class="btn small" onclick="editAnnotation('${a.id}')">编辑</button></div>`).join("") || `<div class="empty">还没有标注。进入精读模式，选择问题单词或句子开始记录。</div>`}</div></div>
  </div>`, "标注本");
}

function filterAnnotations(kind) {
  document.querySelectorAll(".list-row").forEach(row => {
    const tag = row.querySelector(".tag")?.textContent;
    row.style.display = tag === (kind === "word" ? "单词" : "句子") ? "grid" : "none";
  });
  document.querySelectorAll(".filter").forEach(x => x.classList.remove("active")); event.currentTarget.classList.add("active");
}

function reviewView() {
  const all = state.annotations.filter(a => review.kind === "all" || a.kind === review.kind);
  const queue = all.filter(a => a.status !== "mastered" || review.kind !== "all");
  const a = queue[review.index % Math.max(1, queue.length)];
  return shell(`<div class="content"><section class="hero"><div><div class="eyebrow">Review loop</div><h1>复习中心</h1><p class="lede">先回忆，再揭晓；用真实感受评估熟悉程度，系统会安排下一次复习。</p></div><span class="date-stamp">待复习 ${dueAnnotations().length}</span></section>
    <div class="filter-bar"><button class="filter ${review.kind === 'all' ? 'active' : ''}" onclick="setReviewKind('all')">全部</button><button class="filter ${review.kind === 'word' ? 'active' : ''}" onclick="setReviewKind('word')">问题单词</button><button class="filter ${review.kind === 'sentence' ? 'active' : ''}" onclick="setReviewKind('sentence')">问题句子</button></div>
    ${a ? `<div class="review-layout"><div><article class="card flashcard"><span class="source">${esc(annotationSource(a))}</span><div class="flash-main"><span class="tag ${a.kind}">${a.kind === "word" ? "WORD" : "SENTENCE"}</span><div class="flash-word">${esc(a.text)}</div>${a.kind === "word" ? `<p class="flash-context">${esc(sentenceFor(a)?.text || "")}</p>` : ""}${review.revealed ? `<div class="answer"><div class="row-meta">问题类型</div><h3>${esc(a.type)}</h3><p>${esc(a.note || "还没有添加个人笔记。")}</p><span class="tag">当前：${statusLabel(a.status)}</span></div>` : `<button class="btn primary" onclick="revealAnswer()">显示笔记与答案</button>`}</div></article>${review.revealed ? `<div class="review-actions"><button class="grade" onclick="gradeReview(0)">完全不会<small>明天再见</small></button><button class="grade" onclick="gradeReview(1)">有点模糊<small>2 天后</small></button><button class="grade" onclick="gradeReview(2)">想起来了<small>4 天后</small></button><button class="grade" onclick="gradeReview(3)">已经掌握<small>14 天后</small></button></div>` : ""}</div><aside class="card card-pad"><div class="eyebrow">Progress</div><h2>${review.index + 1} / ${queue.length}</h2><div class="progress"><i style="width:${(review.index + 1) / queue.length * 100}%"></i></div><p class="lede" style="font-size:13px;margin-top:20px">先在脑中解释含义或回忆听音难点，再查看自己的笔记。</p><button class="btn" onclick="openReaderFor('${a.id}')">回到原文</button></aside></div>` : `<div class="card empty">复习队列是空的。先去精读页面添加问题词或问题句。</div>`}
  </div>`, "复习中心");
}

function sentenceFor(a) { const { section } = findContext(a.bookId, a.testId, a.sectionId); return section?.sentences.find(s => s.id === a.sentenceId); }
function setReviewKind(kind) { review = { kind, index: 0, revealed: false }; render(); }
function revealAnswer() { review.revealed = true; render(); }
function gradeReview(level) {
  const queue = state.annotations.filter(a => (review.kind === "all" || a.kind === review.kind) && (a.status !== "mastered" || review.kind !== "all"));
  const a = queue[review.index % queue.length]; if (!a) return;
  const days = [1, 2, 4, 14][level]; const date = new Date(); date.setDate(date.getDate() + days);
  a.nextReview = date.toISOString().slice(0, 10); a.reviewCount = (a.reviewCount || 0) + 1;
  a.status = level === 3 ? "mastered" : level >= 2 ? "familiar" : "learning";
  state.activity.push({ type: "review", annotationId: a.id, level, at: new Date().toISOString() });
  saveState(); review.index = review.index + 1; review.revealed = false; toast("复习结果已记录"); render();
}

function settingsView() {
  return shell(`<div class="content"><section class="hero"><div><div class="eyebrow">Preferences</div><h1>设置与数据</h1><p class="lede">调整阅读体验，并定期把长期积累的学习记录导出备份。</p></div></section>
    <div class="grid settings-grid">
      <article class="card setting-card"><h2>阅读设置</h2><div class="field"><label>每页句子数量</label><select class="input" onchange="updateSetting('pageSize',Number(this.value))"><option value="6" ${state.settings.pageSize===6?'selected':''}>6 句 · 宽松</option><option value="8" ${state.settings.pageSize===8?'selected':''}>8 句 · 标准</option><option value="12" ${state.settings.pageSize===12?'selected':''}>12 句 · 紧凑</option></select></div><label style="display:flex;gap:10px;align-items:center;margin:14px 0"><input type="checkbox" ${state.settings.dark?'checked':''} onchange="updateSetting('dark',this.checked)"> 深色阅读模式</label><label style="display:flex;gap:10px;align-items:center"><input type="checkbox" ${state.settings.hideMastered?'checked':''} onchange="updateSetting('hideMastered',this.checked)"> 隐藏已掌握标注</label></article>
      <article class="card setting-card"><h2>备份与恢复</h2><p class="lede">数据只在当前浏览器中保存。更换设备或清理浏览器前，请先导出 JSON 备份。</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" onclick="exportData()">导出备份</button><label class="btn">导入备份<input type="file" accept="application/json" hidden onchange="importData(this.files[0])"></label></div></article>
      <article class="card setting-card"><h2>当前数据</h2><div class="list"><div class="list-row"><span>资料册</span><strong>${state.books.length}</strong></div><div class="list-row"><span>Tests</span><strong>${libraryTestsCount()}</strong></div><div class="list-row"><span>标注</span><strong>${state.annotations.length}</strong></div><div class="list-row"><span>复习记录</span><strong>${state.activity.length}</strong></div></div></article>
      <article class="card setting-card"><h2>重置示例</h2><p class="lede">清空当前浏览器内的资料和学习记录，恢复到最初的示例内容。</p><button class="btn" style="color:#a13c2a" onclick="resetData()">重置全部数据</button></article>
    </div>
  </div>`, "设置");
}

function searchView() {
  const q = window.__searchQuery || "";
  const sentenceMatches = [];
  state.books.forEach(book => book.tests.forEach(test => test.sections.forEach(section => section.sentences.forEach(s => { if (s.text.toLowerCase().includes(q.toLowerCase())) sentenceMatches.push({ book, test, section, sentence: s }); }))));
  const annos = state.annotations.filter(a => `${a.text} ${a.note || ""} ${a.type}`.toLowerCase().includes(q.toLowerCase()));
  return shell(`<div class="content"><section class="hero"><div><div class="eyebrow">Search</div><h1>“${esc(q)}” 的结果</h1><p class="lede">找到 ${sentenceMatches.length} 个原文句子和 ${annos.length} 条标注。</p></div></section><div class="grid two-col"><article class="card card-pad"><h2>原文</h2><div class="list">${sentenceMatches.map(m => `<div class="list-row"><div><div class="row-title">${esc(m.sentence.text)}</div><div class="row-meta">${esc(m.book.title)} · ${esc(m.test.title)} · ${esc(m.section.title)}</div></div><button class="btn small" onclick="jumpToSentence('${m.book.id}','${m.test.id}','${m.section.id}','${m.sentence.id}')">打开</button></div>`).join("") || `<div class="empty">没有匹配的原文。</div>`}</div></article><article class="card card-pad"><h2>标注</h2><div class="list">${annos.map(a => `<div class="list-row"><div><div class="row-title">${esc(a.text)}</div><div class="row-meta">${esc(a.type)}</div></div><button class="btn small" onclick="editAnnotation('${a.id}')">编辑</button></div>`).join("") || `<div class="empty">没有匹配的标注。</div>`}</div></article></div></div>`, "搜索结果");
}

function renderModal() {
  if (modal.type === "import") return importModal();
  if (modal.type === "annotation") return annotationModal();
  return "";
}

function importModal() {
  return `<div class="modal-backdrop" onclick="backdropClose(event)"><div class="modal"><div class="modal-head"><div><h2>导入听力文本</h2><p>粘贴你合法拥有的英文文本。系统会按英文标点自动切分句子。</p></div><button class="btn icon" onclick="closeModal()">×</button></div><form onsubmit="saveImport(event)">
    <div class="field"><label>资料册名称</label><input name="book" class="input" required placeholder="例如：剑雅练习册 18"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label>Test</label><input name="test" class="input" required value="Test 1"></div><div class="field"><label>Section</label><input name="section" class="input" required value="Section 1"></div></div>
    <div class="field"><label>英文文本</label><textarea name="text" class="input" required placeholder="Paste the English transcript here..."></textarea></div>
    <p>提示：同名资料册和 Test 会自动追加新的 Section。</p><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">取消</button><button class="btn primary">切分并导入</button></div>
  </form></div></div>`;
}

function annotationModal() {
  const editing = modal.editingId ? state.annotations.find(a => a.id === modal.editingId) : null;
  const kind = editing?.kind || modal.kind; const text = editing?.text || modal.text;
  const types = kind === "word" ? ["不认识", "听不出来", "拼写问题", "发音问题", "熟词僻义", "反应慢"] : ["听不懂", "结构复杂", "连读弱读", "生词过多", "跟不上语速", "定位失败"];
  const currentType = editing?.type || types[0];
  return `<div class="modal-backdrop" onclick="backdropClose(event)"><div class="modal"><div class="modal-head"><div><span class="tag ${kind}">${kind === "word" ? "问题单词 / 短语" : "问题句子"}</span><h2 style="margin-top:10px">${esc(text)}</h2><p>${editing ? esc(annotationSource(editing)) : "记录它为什么会影响你的听力理解。"}</p></div><button class="btn icon" onclick="closeModal()">×</button></div><form onsubmit="saveAnnotation(event)">
    <div class="field"><label>问题类型</label><div class="type-grid">${types.map((type, i) => `<label class="type-option"><input type="radio" name="annoType" value="${type}" ${type === currentType ? "checked" : ""}><span>${type}</span></label>`).join("")}</div></div>
    <div class="field"><label>个人笔记</label><textarea name="note" class="input" placeholder="释义、听音难点、句子结构或自己的理解……">${esc(editing?.note || "")}</textarea></div>
    ${editing ? `<div class="field"><label>掌握状态</label><select name="status" class="input"><option value="new" ${editing.status==='new'?'selected':''}>新标注</option><option value="learning" ${editing.status==='learning'?'selected':''}>学习中</option><option value="familiar" ${editing.status==='familiar'?'selected':''}>基本掌握</option><option value="mastered" ${editing.status==='mastered'?'selected':''}>已掌握</option></select></div>` : ""}
    <div class="modal-actions">${editing ? `<button type="button" class="btn" style="margin-right:auto;color:#a13c2a" onclick="deleteAnnotation('${editing.id}')">删除</button>` : ""}<button type="button" class="btn" onclick="closeModal()">取消</button><button class="btn primary">${editing ? "保存修改" : "加入标注本"}</button></div>
  </form></div></div>`;
}

function openImport() { modal = { type: "import" }; render(); }
function closeModal() { modal = null; render(); }
function backdropClose(e) { if (e.target.classList.contains("modal-backdrop")) closeModal(); }

function splitSentences(text) {
  const cleaned = text.replace(/\r/g, " ").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned.match(/[^.!?]+[.!?]+(?:[”"'])?|[^.!?]+$/g) || [cleaned]).map(s => s.trim()).filter(Boolean);
}

function saveImport(e) {
  e.preventDefault(); const data = new FormData(e.target); const bookTitle = data.get("book").trim(); const testTitle = data.get("test").trim(); const sectionTitle = data.get("section").trim();
  const sentences = splitSentences(data.get("text")); if (!sentences.length) return toast("没有识别到有效文本");
  let book = state.books.find(b => b.title.toLowerCase() === bookTitle.toLowerCase());
  if (!book) { book = { id: uid("book"), title: bookTitle, note: "个人导入材料", tests: [] }; state.books.push(book); }
  let test = book.tests.find(t => t.title.toLowerCase() === testTitle.toLowerCase());
  if (!test) { test = { id: uid("test"), title: testTitle, sections: [] }; book.tests.push(test); }
  const section = { id: uid("section"), title: sectionTitle, sentences: sentences.map(text => ({ id: uid("sentence"), text })) };
  test.sections.push(section); reader = { bookId: book.id, testId: test.id, sectionId: section.id, page: 0 };
  state.progress[test.id] = { sectionId: section.id, page: 0, updatedAt: new Date().toISOString() };
  saveState(); modal = null; view = "reader"; toast(`已导入 ${sentences.length} 个句子`); render();
}

function saveAnnotation(e) {
  e.preventDefault(); const data = new FormData(e.target);
  if (modal.editingId) {
    const a = state.annotations.find(x => x.id === modal.editingId); a.type = data.get("annoType"); a.note = data.get("note").trim(); a.status = data.get("status") || a.status;
  } else {
    const { book, test, section } = findContext();
    state.annotations.push({ id: uid("anno"), kind: modal.kind, text: modal.text, sentenceId: modal.sentenceId, bookId: book.id, testId: test.id, sectionId: section.id, type: data.get("annoType"), note: data.get("note").trim(), status: "new", nextReview: today(), reviewCount: 0, createdAt: new Date().toISOString() });
  }
  saveState(); modal = null; toast("标注已保存"); render();
}

function deleteAnnotation(id) { if (!confirm("确定删除这条标注吗？")) return; state.annotations = state.annotations.filter(a => a.id !== id); saveState(); modal = null; toast("标注已删除"); render(); }
function statusLabel(status) { return ({ new: "新标注", learning: "学习中", familiar: "基本掌握", mastered: "已掌握" })[status] || "新标注"; }

function go(next) { view = next; modal = null; document.getElementById("sidebar")?.classList.remove("open"); window.scrollTo({ top: 0, behavior: "smooth" }); render(); }
function toggleMenu() { document.getElementById("sidebar")?.classList.toggle("open"); }
function toggleDark() { state.settings.dark = !state.settings.dark; saveState(); render(); }
function changeFont(delta) { state.settings.fontScale = Math.max(.8, Math.min(1.4, +(state.settings.fontScale + delta).toFixed(1))); saveState(); render(); }
function updateSetting(key, value) { state.settings[key] = value; saveState(); render(); toast("设置已保存"); }

function continueReading() {
  const last = lastProgress(); if (!last.test) return openImport();
  reader = { bookId: last.book.id, testId: last.test.id, sectionId: last.section.id, page: last.page || 0 }; go("reader");
}

function switchBook(bookId) { const book = state.books.find(b => b.id === bookId); const test = book.tests[0]; const section = test.sections[0]; reader = { bookId, testId: test.id, sectionId: section.id, page: 0 }; render(); }
function switchTest(testId) { const book = state.books.find(b => b.id === reader.bookId); const test = book.tests.find(t => t.id === testId); reader.testId = test.id; reader.sectionId = test.sections[0].id; reader.page = 0; render(); }
function switchSection(sectionId) { reader.sectionId = sectionId; reader.page = 0; recordProgress(); render(); }
function pageReader(delta) {
  const { section } = findContext();
  const lastPage = Math.max(0, Math.ceil(section.sentences.length / state.settings.pageSize) - 1);
  const next = Math.max(0, Math.min(lastPage, reader.page + delta));
  if (next === reader.page) return;
  reader.page = next; recordProgress(); window.scrollTo({ top: 0, behavior: "smooth" }); render();
}
function recordProgress() { state.progress[reader.testId] = { sectionId: reader.sectionId, page: reader.page, updatedAt: new Date().toISOString() }; saveState(); }
function openReaderFor(id) { const a = state.annotations.find(x => x.id === id); jumpToSentence(a.bookId, a.testId, a.sectionId, a.sentenceId); }
function jumpToSentence(bookId, testId, sectionId, sentenceId) { const { section } = findContext(bookId, testId, sectionId); const index = section.sentences.findIndex(s => s.id === sentenceId); reader = { bookId, testId, sectionId, page: Math.max(0, Math.floor(index / state.settings.pageSize)) }; recordProgress(); go("reader"); }
function searchAll(q) { if (!q.trim()) return; window.__searchQuery = q.trim(); view = "search"; render(); }

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = `听力精读本备份-${today()}.json`; a.click(); URL.revokeObjectURL(url); toast("备份已导出");
}

function importData(file) {
  if (!file) return; const readerFile = new FileReader(); readerFile.onload = () => { try { const parsed = JSON.parse(readerFile.result); if (parsed.version !== 1 || !Array.isArray(parsed.books)) throw new Error(); state = parsed; saveState(); toast("备份已恢复"); render(); } catch (_) { alert("无法识别这个备份文件。请确认它由本网站导出。"); } }; readerFile.readAsText(file);
}

function resetData() { if (!confirm("这会清空当前浏览器中的资料、标注和复习记录。确定继续吗？")) return; state = freshState(); saveState(); view = "dashboard"; render(); toast("已恢复初始示例"); }

document.addEventListener("mousedown", e => { if (!e.target.closest("#selection-menu")) closeSelectionMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && modal) closeModal(); if (!modal && view === "reader" && e.key === "ArrowRight") pageReader(1); if (!modal && view === "reader" && e.key === "ArrowLeft") pageReader(-1); });
render();
