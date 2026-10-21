import fs from "node:fs";
import vm from "node:vm";

const appElement = { innerHTML: "" };
const toastElement = { textContent: "", classList: { add() {}, remove() {} } };
const context = {
  console,
  Date,
  Math,
  JSON,
  Blob,
  URL,
  setTimeout,
  clearTimeout,
  requestAnimationFrame(callback) { callback(); },
  localStorage: { getItem() { return null; }, setItem() {} },
  confirm() { return true; },
  alert() {},
  document: {
    body: { classList: { toggle() {} } },
    getElementById(id) { return id === "app" ? appElement : toastElement; },
    querySelector() { return null; },
    addEventListener() {}
  }
};
context.window = context;
context.window.scrollTo = () => {};
context.window.LISTENING_LIBRARY = [{
  id: "cambridge_1",
  title: "剑桥雅思 1",
  source: "catalog",
  note: "测试资料",
  tests: [{ id: "cam1_t1", title: "Test 1", sections: [{ id: "cam1_t1_sec1", title: "Section 1", sentences: [{ id: "s1", text: "A sample sentence." }] }] }]
}];

vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../dist/app.js", import.meta.url), "utf8"), context);
if (!appElement.innerHTML.includes("学习首页")) throw new Error("Dashboard did not render");
vm.runInContext("view = 'practice'; render();", context);
if (!appElement.innerHTML.includes("练习仪表盘") || !appElement.innerHTML.includes("Section 1")) throw new Error("Practice dashboard did not render");
if (!appElement.innerHTML.includes("剑雅练习贡献图") || !appElement.innerHTML.includes("contribution-cell")) throw new Error("Practice contribution map did not render");
if (!appElement.innerHTML.includes("新增一次")) throw new Error("Add-attempt control did not render");
vm.runInContext("addPracticeAttempt('cambridge_1','cam1_t1','cam1_t1_sec1');", context);
if (!appElement.innerHTML.includes('name="date"') || !appElement.innerHTML.includes('name="correct"') || !appElement.innerHTML.includes('name="total"') || !appElement.innerHTML.includes("第 1 次")) throw new Error("Correct/total practice inputs did not render");
if (!appElement.innerHTML.includes('value="10"') || appElement.innerHTML.includes('name="accuracy"') || appElement.innerHTML.includes('name="wrong"')) throw new Error("Correct/total defaults or legacy fields are incorrect");
if (!appElement.innerHTML.includes("level-1")) throw new Error("Completed practice was not reflected in contribution map");
if (appElement.innerHTML.includes("记录下一节") || appElement.innerHTML.includes("保存练习数据")) throw new Error("Legacy practice controls are still visible");
console.log("Smoke test passed: dashboard and correct/total practice inputs rendered.");
