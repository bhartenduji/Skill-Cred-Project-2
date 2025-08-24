// --------- Init & Helpers ---------
(function ensurePDFJS() {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    console.error("PDF.js not loaded. Check the CDN script tag in index.html.");
    return;
  }
  // Must match the version we loaded in index.html (2.11.338)
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js";

  console.log("PDF.js ready ✅");
})();

function setStatus(msg) {
  const summaryEl = document.getElementById("summary");
  if (!summaryEl) return;
  summaryEl.textContent = msg;
  summaryEl.classList.remove("hidden");
}

function clearStatus() {
  const summaryEl = document.getElementById("summary");
  if (!summaryEl) return;
  summaryEl.textContent = "";
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --------- PDF Extraction ---------
async function extractTextFromPDF(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) {
    throw new Error("PDF.js library not loaded. Check the <script> include in index.html.");
  }

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let textContent = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();
    text.items.forEach((item) => {
      textContent += item.str + " ";
    });
    textContent += "\n"; // page separator improves regex parsing
  }
  return textContent;
}

// --------- Regex Parser (MCQ format) ---------
function generateQuestionsFromText(text) {
  const questions = [];

  // Split by numbered blocks like "1.)", "2:", "3 -", etc.
  const regex = /(\d+[).:-]\s*.*?)(?=(?:\n?\s*\d+[).:-]|$))/gs;
  const matches = [...text.matchAll(regex)];

  matches.forEach((match) => {
    const block = match[1].trim();

    // Capture the question line up to where options likely begin
    const qMatch = block.match(/^\d+[).:-]\s*(.*?)(?=(?:\n?\s*[A-D][).:-]|\n|$))/s);
    if (!qMatch) return;
    const question = qMatch[1].replace(/\s+/g, " ").trim();

    const options = [];
    const optionRegex = /\n?\s*([A-D])[).:-]?\s+(.*?)(?=(?:\n\s*[A-D][).:-]|\n\s*Answer|$))/gis;
    const optionMatches = [...block.matchAll(optionRegex)];
    optionMatches.forEach((o) => options.push(o[2].replace(/\s+/g, " ").trim()));

    const ansMatch = block.match(/Answer[:\s]*([A-D])/i);
    const answer = ansMatch ? ansMatch[1].toUpperCase() : null;

    if (question && options.length >= 2) {
      questions.push({ question, options, answer });
    }
  });

  return questions;
}

// --------- True/False Generation ---------
function generateTrueFalseFromText(text, desired = 20, difficulty = "medium") {
  if (!text || typeof text !== "string") return [];

  function splitSentences(t) {
    return t
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.length > 30 && s.length < 200);
  }

  const sentences = splitSentences(text);
  if (!sentences.length) return [];

  // Create T/F by negating some sentences with simple heuristics
  const negations = [
    [/(\bis\s)(?!not\b)/i, "$1not "],
    [/(\bare\s)(?!not\b)/i, "$1not "],
    [/(\bwas\s)(?!not\b)/i, "$1not "],
    [/(\bwere\s)(?!not\b)/i, "$1not "],
    [/(\bcan\s)(?!not\b)/i, "$1not "],
    [/(\bshould\s)(?!not\b)/i, "$1not "],
    [/(\bcould\s)(?!not\b)/i, "$1not "],
    [/(\bwill\s)(?!not\b)/i, "$1not "],
  ];

  const questions = [];
  for (let s of sentences) {
    if (questions.length >= desired) break;

    // Decide randomly if this will be True or False based on difficulty
    const makeFalse = Math.random() < (difficulty === "easy" ? 0.4 : difficulty === "hard" ? 0.65 : 0.55);

    let statement = s.trim();
    let correctAnswer = "A"; // default True

    if (makeFalse) {
      // Try a negation pass
      let negated = statement;
      for (const [re, rep] of negations) {
        if (re.test(negated)) {
          negated = negated.replace(re, rep);
          break;
        }
      }
      if (negated === statement) {
        // Fallback: swap a numeric value if present (e.g., 10 -> 11)
        negated = negated.replace(/(\b\d{1,3}\b)/, (m) => String(parseInt(m, 10) + 1));
      }
      statement = negated;
      correctAnswer = "B"; // False
    }

    questions.push({
      question: statement,
      options: ["True", "False"],
      answer: correctAnswer,
    });
  }

  return questions;
}

// Flexible True/False with relaxed fallback to guarantee count
function generateTrueFalseFlexible(text, desired = 20, difficulty = "medium") {
  let out = generateTrueFalseFromText(text, desired, difficulty) || [];
  if (out.length >= desired) return out.slice(0, desired);
  const need = desired - out.length;
  const fill = generateTrueFalseFallback(text, need);
  return out.concat(fill).slice(0, desired);
}

function generateTrueFalseFallback(text, desired) {
  if (!text || typeof text !== "string" || desired <= 0) return [];
  function splitSentencesRelaxed(t) {
    return t
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim().length > 12 && s.trim().length < 320);
  }
  const sentences = splitSentencesRelaxed(text);
  const negations = [
    [/\b(is|are|was|were|can|should|could|will)\s(?!not\b)/i, "$1 not "],
  ];
  const seen = new Set();
  const results = [];
  for (let s of sentences) {
    if (results.length >= desired) break;
    s = s.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let makeFalse = Math.random() < 0.6;
    let statement = s;
    let correct = "A";

    if (makeFalse) {
      let negated = statement;
      for (const [re, rep] of negations) {
        if (re.test(negated)) { negated = negated.replace(re, rep); break; }
      }
      if (negated !== statement) {
        statement = negated;
        correct = "B";
      }
    }

    results.push({ question: statement, options: ["True", "False"], answer: correct });
  }
  return results.slice(0, desired);
}

// --------- Heuristic Generation (fallback) ---------
function generateQuestionsHeuristic(text, desired = 20, difficulty = "medium") {
  if (!text || typeof text !== "string") return [];

  const stop = new Set([
    "the","and","for","are","with","that","this","from","have","was","were","has","had","not","but","you","your","about","into","over","than","then","they","them","their","there","here","what","when","where","which","while","will","would","could","should","can","also","such","each","more","most","some","many","much","very","just","like","upon","only","other","these","those","between","within","across","because","before","after","during","without","against","among","under","above","into","also","may","might","another","being","been","who","whom","whose","our","ours","its","it's","his","her","hers","him","she","he","it","we","i"
  ]);

  function splitSentences(t) {
    return t
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.length > 30 && s.length < 240);
  }

  function words(t) {
    return (t.match(/[A-Za-z][A-Za-z'-]{3,}/g) || []).map((w) => w.toLowerCase());
  }

  const sentences = splitSentences(text);
  const allWords = words(text).filter((w) => !stop.has(w));
  if (allWords.length === 0 || sentences.length === 0) return [];

  const freq = new Map();
  allWords.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));

  let candidates = [...freq.entries()]
    .filter(([w, c]) => c >= (difficulty === "hard" ? 2 : 1))
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  const proper = Array.from(new Set((text.match(/\b[A-Z][a-z]{3,}\b/g) || []).map((w) => w.toLowerCase())));
  candidates = Array.from(new Set([...proper, ...candidates]));

  function pickDistractors(correct, k = 3) {
    const pool = candidates.filter(
      (w) => w !== correct && Math.abs(w.length - correct.length) <= (difficulty === "easy" ? 4 : 2)
    );
    const unique = Array.from(new Set(pool)).slice(0, 50);
    shuffle(unique);
    let picks = unique.slice(0, k);
    if (picks.length < k) {
      const extras = candidates.filter((w) => w !== correct && !picks.includes(w));
      shuffle(extras);
      picks = picks.concat(extras.slice(0, k - picks.length));
    }
    return picks.slice(0, k);
  }

  const results = [];
  const usedSentences = new Set();

  for (const s of sentences) {
    if (results.length >= desired) break;
    if (usedSentences.has(s)) continue;

    const sWordsLc = (s.match(/[A-Za-z][A-Za-z'-]{3,}/g) || []).map((w) => w.toLowerCase());
    const target = sWordsLc.find((w) => candidates.includes(w) && !stop.has(w));
    if (!target) continue;

    // Escape the target for a safe regex, then blank it in the sentence
    const escaped = escapeRegExp(target);
    const targetRegex = new RegExp(`\\b${escaped}\\b`, "i");
    if (!targetRegex.test(s)) continue;

    const questionText = s.replace(targetRegex, "____").trim();
    if (!questionText || !questionText.includes("____")) continue;

    const distractors = pickDistractors(target, 3).map((w) => w[0].toUpperCase() + w.slice(1));
    if (distractors.length < 3) continue;

    const correctOpt = target[0].toUpperCase() + target.slice(1);
    const options = [correctOpt, ...distractors];
    shuffle(options);
    const answerIdx = options.findIndex((o) => o.toLowerCase() === target.toLowerCase());
    const answerLetter = String.fromCharCode(65 + (answerIdx === -1 ? 0 : answerIdx));

    results.push({
      question: `Fill in the blank: ${questionText}`,
      options,
      answer: answerLetter,
    });

    usedSentences.add(s);
  }

  return results.slice(0, desired);
}

// Flexible MCQ generator that relaxes difficulty to meet desired count
function generateHeuristicMCQsFlexible(text, desired, difficulty = "medium") {
  const order = Array.from(new Set([difficulty, "medium", "easy"]));
  const seen = new Set();
  const out = [];

  for (const level of order) {
    if (out.length >= desired) break;
    let batch = generateQuestionsHeuristic(text, desired - out.length, level) || [];
    // sanitize and dedupe by question text
    batch = batch.filter(q => q && q.question && Array.isArray(q.options) && q.options.length >= 2);
    for (const q of batch) {
      const key = q.question.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= desired) break;
    }
  }
  return out.slice(0, desired);
}

// Ultra fallback MCQ generator (safe) to guarantee count
function ultraFallbackMCQsSafe(text, desired) {
  if (!text || typeof text !== "string" || desired <= 0) return [];

  const stop = new Set([
    "the","and","for","are","with","that","this","from","have","was","were","has","had","not","but","you","your","about","into","over","than","then","they","them","their","there","here","what","when","where","which","while","will","would","could","should","can","also","such","each","more","most","some","many","much","very","just","like","upon","only","other","these","those","between","within","across","because","before","after","during","without","against","among","under","above","into","also","may","might","another","being","been","who","whom","whose","our","ours","its","it's","his","her","hers","him","she","he","it","we","i"
  ]);

  function splitSentences(t) {
    return t
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.length > 20 && s.length < 260);
  }

  const sentences = splitSentences(text);
  let vocab = (text.match(/[A-Za-z][A-Za-z'-]{3,}/g) || []).map(w => w.toLowerCase()).filter(w => !stop.has(w));
  vocab = Array.from(new Set(vocab));
  const results = [];
  const usedSentences = new Set();
  const seen = new Set();

  for (const s of sentences) {
    if (results.length >= desired) break;
    if (usedSentences.has(s)) continue;

    const words = (s.match(/[A-Za-z][A-Za-z'-]{3,}/g) || []);
    const targetRaw = words.find(w => !stop.has(w.toLowerCase()) && w.length >= 4);
    if (!targetRaw) continue;

    const target = targetRaw.toLowerCase();
    const escaped = escapeRegExp(target);
    const targetRegex = new RegExp(`\\b${escaped}\\b`, "i");
    if (!targetRegex.test(s)) continue;

    const questionText = s.replace(targetRegex, "____").trim();
    const qKey = questionText.toLowerCase();
    if (!questionText || !questionText.includes("____") || seen.has(qKey)) continue;

    // Distractors from vocab by length proximity first
    let pool = vocab.filter(w => w !== target && Math.abs(w.length - target.length) <= 4);
    shuffle(pool);
    let distractors = pool.slice(0, 3);

    if (distractors.length < 3) {
      const extras = vocab.filter(w => w !== target && !distractors.includes(w));
      shuffle(extras);
      distractors = distractors.concat(extras.slice(0, 3 - distractors.length));
    }

    // Final padding with generic placeholders if still short
    const generics = ["Unknown", "N/A", "None of the above", "All of the above"];
    while (distractors.length < 3) {
      const g = generics[(results.length + distractors.length) % generics.length];
      if (!distractors.includes(g)) distractors.push(g);
    }

    const correctOpt = target[0].toUpperCase() + target.slice(1);
    const options = [correctOpt, ...distractors.map(w => w[0].toUpperCase() + w.slice(1))];
    shuffle(options);
    const answerIdx = options.findIndex(o => o.toLowerCase() === target.toLowerCase());
    const answerLetter = String.fromCharCode(65 + (answerIdx === -1 ? 0 : answerIdx));

    results.push({ question: `Fill in the blank: ${questionText}`, options, answer: answerLetter });

    usedSentences.add(s);
    seen.add(qKey);
  }

  return results.slice(0, desired);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --------- Quiz Rendering ---------
function renderQuiz(quizData) {
  const quizContainer = document.getElementById("quiz-container");
  const quizForm = document.getElementById("quiz-form");

  quizForm.innerHTML = "";

  const answersIndex = [];
  const letter = (i) => String.fromCharCode(65 + i); // 0 -> A

  quizData.forEach((q, idx) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "question";

    const legend = document.createElement("legend");
    legend.textContent = `${idx + 1}. ${q.question}`;
    fieldset.appendChild(legend);

    const opts = q.options.slice(0, 6); // safety cap
    const correctLetter = q.answer && /^[A-F]$/.test(q.answer) ? q.answer.toUpperCase() : null;

    opts.forEach((opt, i) => {
      const id = `q${idx}_${i}`;
      const wrap = document.createElement("div");
      wrap.className = "option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `q${idx}`;
      input.id = id;
      input.value = letter(i);

      const label = document.createElement("label");
      label.setAttribute("for", id);
      label.textContent = `${letter(i)}. ${opt}`;

      wrap.appendChild(input);
      wrap.appendChild(label);
      fieldset.appendChild(wrap);
    });

    answersIndex[idx] = correctLetter ?? null;
    quizForm.appendChild(fieldset);
  });

  quizForm.dataset.answers = JSON.stringify(answersIndex);
  quizContainer.classList.remove("hidden");
}

function gradeQuiz() {
  const quizForm = document.getElementById("quiz-form");
  const answersIndex = JSON.parse(quizForm.dataset.answers || "[]");
  let correct = 0;
  let total = answersIndex.length;

  answersIndex.forEach((ans, idx) => {
    const selected = quizForm.querySelector(`input[name="q${idx}"]:checked`);
    if (!selected || !ans) return; // cannot grade without answer key
    if (selected.value.toUpperCase() === ans) correct++;
  });

  setStatus(`Score: ${correct} / ${total}`);
}

// --------- Export to PDF ---------
function exportQuizToPDF() {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    setStatus("jsPDF not available.");
    return;
  }
  const doc = new jsPDF();

  const marginX = 12;
  const lineH = 6;
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title (centered with underline)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("PDF to Quiz", pageWidth / 2, 18, { align: "center" });
  doc.setDrawColor(150);
  doc.line(marginX, 22, pageWidth - marginX, 22);

  const quizForm = document.getElementById("quiz-form");
  const questions = quizForm.querySelectorAll(".question");
  const answersIndex = JSON.parse(quizForm.dataset.answers || "[]");

  let y = 28;
  questions.forEach((q, i) => {
    const legend = q.querySelector("legend")?.textContent || `Q${i + 1}`;
    doc.setFontSize(12);
    if (y > 280) { doc.addPage(); y = 15; }
    doc.text(legend, marginX, y);
    y += lineH;

    const labels = q.querySelectorAll(".option label");
    labels.forEach((lbl) => {
      const text = lbl.textContent || "";
      if (y > 280) { doc.addPage(); y = 15; }
      doc.text(text, marginX + 4, y);
      y += lineH;
    });
    y += 4;
  });

  // Answers section on a new page
  doc.addPage();
  const pw = doc.internal.pageSize.getWidth();
  y = 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Answer Key", pw / 2, y, { align: "center" });
  doc.setDrawColor(150);
  doc.line(marginX, y + 4, pw - marginX, y + 4);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);

  questions.forEach((q, i) => {
    const ansLetter = (answersIndex[i] || "").toString().toUpperCase();
    let line = `Q${i + 1}: `;
    if (ansLetter && /^[A-F]$/.test(ansLetter)) {
      const idx = ansLetter.charCodeAt(0) - 65;
      const labels = q.querySelectorAll(".option label");
      const labelText = labels[idx]?.textContent || "";
      const optText = labelText.replace(/^[A-F][).]?\s*/, "").trim();
      line += `${ansLetter}. ${optText}`;
    } else {
      line += "N/A";
    }

    if (y > 280) { doc.addPage(); y = 15; doc.setFontSize(12); }
    doc.text(line, marginX, y);
    y += lineH;
  });

  doc.save("quiz.pdf");
}

// --------- Drag & Drop ---------
function setupDragAndDrop() {
  const dz = document.getElementById("drop-zone");
  const fileInput = document.getElementById("pdf-upload");
  if (!dz || !fileInput) return;

  // Accessibility and click-to-open
  dz.setAttribute("role", "button");
  dz.setAttribute("aria-label", "Upload PDF via drag and drop or click");
  dz.tabIndex = 0;
  const openPicker = () => fileInput.click();
  dz.addEventListener("click", openPicker);
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
  });

  // Prevent browser from opening the file on drop outside the zone
  ["dragover", "drop"].forEach((evt) =>
    window.addEventListener(evt, (e) => {
      e.preventDefault();
    })
  );

  // Stabilize dragover highlight using a depth counter
  let dragDepth = 0;
  dz.addEventListener("dragenter", (e) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth++;
    dz.classList.add("dragover");
  });

  dz.addEventListener("dragover", (e) => {
    e.preventDefault(); e.stopPropagation();
  });

  dz.addEventListener("dragleave", (e) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dz.classList.remove("dragover");
  });

  dz.addEventListener("drop", async (e) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth = 0;
    dz.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setStatus("Please drop a PDF file.");
      return;
    }
    await handlePDF(file);
  });
}

// --------- Main Flow ---------
let extractedText = "";

async function handlePDF(file) {
  setStatus("Extracting text from PDF...");
  try {
    extractedText = await extractTextFromPDF(file);
    setStatus("PDF text extracted. Click 'Generate Quiz' to create questions.");
  } catch (err) {
    console.error(err);
    setStatus("Failed to read PDF. See console for details.");
  }
}

function bindEvents() {
  const fileInput = document.getElementById("pdf-upload");
  const generateBtn = document.getElementById("generate-quiz-btn");
  const submitBtn = document.getElementById("submit-answers-btn");
  const exportBtn = document.getElementById("export-pdf-btn");

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) await handlePDF(file);
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener("click", async () => {
      if (!extractedText) {
        setStatus("No PDF loaded. Please upload a PDF first.");
        return;
      }

      const mcqCount = parseInt(document.getElementById("num-mcq")?.value || "0", 10);
      const tfCount = parseInt(document.getElementById("num-tf")?.value || "0", 10);
      const difficulty = document.getElementById("difficulty")?.value || "medium";

      if ((mcqCount + tfCount) <= 0) {
        setStatus("Set MCQ or True/False count to at least 1.");
        return;
      }

      setStatus("Generating questions...");

      // MCQ generation
      let mcqs = [];
      if (mcqCount > 0) {
        // Try parsing MCQs from text
        mcqs = generateQuestionsFromText(extractedText) || [];
        mcqs = Array.isArray(mcqs) ? mcqs.filter((q) => q?.question && Array.isArray(q?.options) && q.options.length >= 2) : [];
        // If parsed MCQs are insufficient, fill using heuristic with relaxing difficulty
        if (mcqs.length < mcqCount) {
          if (mcqs.length === 0) {
            setStatus("Regex parsing failed. Generating heuristic MCQs...");
          }
          const needed = mcqCount - mcqs.length;
          const fill = generateHeuristicMCQsFlexible(extractedText, needed, difficulty);
          mcqs = mcqs.concat(fill);
        }
        // Ultimate fallback to guarantee count
        if (mcqs.length < mcqCount) {
          const needed2 = mcqCount - mcqs.length;
          const fill2 = ultraFallbackMCQsSafe(extractedText, needed2);
          // Deduplicate by question text
          const seenQ = new Set(mcqs.map(q => (q.question || '').trim().toLowerCase()));
          for (const q of fill2) {
            const key = (q.question || '').trim().toLowerCase();
            if (!seenQ.has(key)) {
              mcqs.push(q);
              seenQ.add(key);
              if (mcqs.length >= mcqCount) break;
            }
          }
        }

        if (mcqs.length > mcqCount) mcqs = mcqs.slice(0, mcqCount);
      }

      // True/False generation (with fallback)
      let tfs = [];
      if (tfCount > 0) {
        tfs = generateTrueFalseFlexible(extractedText, tfCount, difficulty) || [];
        tfs = Array.isArray(tfs) ? tfs.filter((q) => q?.question && Array.isArray(q?.options) && q.options.length >= 2) : [];
        if (tfs.length > tfCount) tfs = tfs.slice(0, tfCount);
      }

      const quizData = [...mcqs, ...tfs];
      if (!quizData || quizData.length === 0) {
        setStatus("Could not generate questions from this PDF. Try another file or adjust formatting.");
        return;
      }

      setStatus(`Loaded ${mcqs.length} MCQ and ${tfs.length} True/False questions (difficulty: ${difficulty}) ✅`);
      renderQuiz(quizData);
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", (e) => {
      e.preventDefault();
      gradeQuiz();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      exportQuizToPDF();
    });
  }

  setupDragAndDrop();
}

// Initialize
bindEvents();
