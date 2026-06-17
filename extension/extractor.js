// Article extraction module using Readability.js
// Runs in the page context (via content script or executeScript)

function extractArticle() {
  if (typeof Readability === "undefined") {
    return { success: false, text: null, reason: "Readability library not available" };
  }

  try {
    // Clone the document to avoid mutating the page
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (!article || !article.content) {
      return { success: false, text: null, reason: "No article content found" };
    }

    // Extract text from the article HTML
    const temp = document.createElement("div");
    temp.innerHTML = article.content;
    let text = temp.innerText || temp.textContent || "";

    // Clean up: trim, remove excess whitespace
    text = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    // Check minimum length (reasonable article is at least 100 chars)
    if (!text || text.length < 100) {
      return { success: false, text: null, reason: "Extracted text too short" };
    }

    return { success: true, text, title: article.title };
  } catch (error) {
    return { success: false, text: null, reason: `Extraction error: ${error.message}` };
  }
}
