const STORAGE_KEY = "foloBlockKeywords";

const input = document.getElementById("kw-input");
const addBtn = document.getElementById("kw-add");
const list = document.getElementById("kw-list");

function readKeywords() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const raw = result[STORAGE_KEY];
      if (!raw) return resolve([]);
      if (Array.isArray(raw)) return resolve(raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return resolve(parsed.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
        } catch {}
        return resolve(raw.split(/[,\n，]/).map((s) => s.trim().toLowerCase()).filter(Boolean));
      }
      resolve([]);
    });
  });
}

function saveKeywords(keywords) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: keywords }, resolve);
  });
}

async function render() {
  const keywords = await readKeywords();
  list.innerHTML = "";
  keywords.forEach((kw) => {
    const li = document.createElement("li");
    li.className = "keyword-item";

    const span = document.createElement("span");
    span.className = "keyword-text";
    span.textContent = kw;

    const btn = document.createElement("button");
    btn.className = "keyword-del";
    btn.type = "button";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    btn.addEventListener("click", () => removeKeyword(kw));

    li.appendChild(span);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

async function addKeyword() {
  const raw = input.value.trim().toLowerCase();
  if (!raw) return;
  const keywords = await readKeywords();
  if (keywords.includes(raw)) {
    input.value = "";
    return;
  }
  keywords.push(raw);
  await saveKeywords(keywords);
  input.value = "";
  render();
}

async function removeKeyword(kw) {
  const keywords = (await readKeywords()).filter((k) => k !== kw);
  await saveKeywords(keywords);
  render();
}

addBtn.addEventListener("click", addKeyword);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addKeyword();
});

render();
