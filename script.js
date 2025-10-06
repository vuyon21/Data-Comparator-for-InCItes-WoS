document.addEventListener('DOMContentLoaded', function () {
  const templateInput = document.getElementById('templateFile');
  const dataInput = document.getElementById('dataFile');
  const processBtn = document.getElementById('processBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const previewDiv = document.getElementById('preview');

  const fieldMapping = {
    "PersonID": "Employee ID",
    "FirstName": "Name, First",
    "LastName": "Name, Last",
    "OrganizationID": "Department",
    "AuthorID": "ORCID iD",
    "EmailAddress": "Email"
  };

  let mergedRows = [];

  processBtn.addEventListener('click', async () => {
    const templateFile = templateInput.files[0];
    const dataFile = dataInput.files[0];
    if (!templateFile || !dataFile) {
      alert("Please select both template and data files.");
      return;
    }

    const templateText = await readFileAsText(templateFile);
    const dataText = await readFileAsText(dataFile);

    const templateRows = parseDelimitedFile(templateText);
    const dataRows = parseDelimitedFile(dataText);
    if (!templateRows.length || !dataRows.length) {
      alert("Files seem empty or invalid.");
      return;
    }

    const emailToTemplate = {};
    const idToTemplate = {};

    templateRows.forEach(row => {
      const email = (row["EmailAddress"] || "").toLowerCase();
      const id = (row["PersonID"] || "").trim();
      if (email) emailToTemplate[email] = row;
      if (id) idToTemplate[id] = row;
    });

    const seen = new Set();
    mergedRows = [...templateRows];

    dataRows.forEach(dRow => {
      const email = (dRow["Email"] || "").toLowerCase();
      const id = (dRow["Employee ID"] || "").trim();

      let matchRow = emailToTemplate[email] || idToTemplate[id];
      const key = `${email}|${id}`;
      if (seen.has(key)) return;
      seen.add(key);

      if (matchRow) {
        // fill missing fields only
        for (const [tField, dField] of Object.entries(fieldMapping)) {
          if (!matchRow[tField] && dRow[dField]) {
            matchRow[tField] = dRow[dField].trim();
          }
        }
      } else {
        // add new row
        const newRow = {};
        for (const [tField, dField] of Object.entries(fieldMapping)) {
          newRow[tField] = dRow[dField] ? dRow[dField].trim() : "";
        }
        mergedRows.push(newRow);
      }
    });

    showPreview(mergedRows);
  });

  // --- Utilities ---
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function parseDelimitedFile(text) {
    const firstLine = text.split('\n')[0];
    const delimiter = firstLine.includes(';') ? ';' : (firstLine.includes('\t') ? '\t' : ',');
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(delimiter).map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(delimiter);
      const obj = {};
      headers.forEach((h, i) => (obj[h] = (vals[i] || "").trim()));
      return obj;
    });
  }

  function showPreview(rows) {
    if (!rows.length) {
      previewDiv.innerHTML = "<p>No merged data.</p>";
      return;
    }
    const headers = Object.keys(rows[0]);
    let html = "<table><thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
    rows.forEach(r => {
      html += "<tr>" + headers.map(h => `<td>${r[h] || ""}</td>`).join("") + "</tr>";
    });
    html += "</tbody></table>";
    previewDiv.innerHTML = html;
  }

  downloadBtn.addEventListener('click', () => {
    if (!mergedRows.length) {
      alert("No merged data to download.");
      return;
    }
    const headers = Object.keys(mergedRows[0]);
    let csv = headers.join(';') + '\n';
    mergedRows.forEach(r => {
      csv += headers.map(h => `"${(r[h] || '').replace(/"/g, '""')}"`).join(';') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'merged_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});

