document.addEventListener('DOMContentLoaded', function () {
    const templateInput = document.getElementById('templateFile');
    const dataInput = document.getElementById('dataFiles');
    const processBtn = document.getElementById('processBtn');
    const resultSection = document.getElementById('resultSection');
    const statsDiv = document.getElementById('stats');
    const previewDiv = document.getElementById('preview');
    const downloadCsvBtn = document.getElementById('downloadCsv');
    const downloadExcelBtn = document.getElementById('downloadExcel');

    let templateData = null;
    let allDataRows = [];

    // Fixed Template column order
    const TEMPLATE_HEADERS = [
        "PersonID",
        "FirstName",
        "LastName",
        "OrganizationID",
        "DocumentID",
        "UT (Unique WOS ID)",
        "AuthorID",
        "EmailAddress",
        "OtherNames",
        "FormerInstitution"
    ];

    // Required columns for Template and Data
    const REQUIRED_TEMPLATE_HEADERS = ["PersonID", "AuthorID", "EmailAddress"];
    const REQUIRED_DATA_HEADERS = ["Staff/student number", "ORCID", "Email", "Name", "Department/School/Unit"];

    [templateInput, dataInput].forEach(input => {
        input.addEventListener('change', () => {
            processBtn.disabled = !(templateInput.files.length > 0 && dataInput.files.length > 0);
        });
    });

    processBtn.addEventListener('click', async () => {
        clearResults();
        try {
            // --- Load Template ---
            const templateFile = templateInput.files[0];
            const templateText = await readFileAsText(templateFile);
            templateData = parseDelimitedFile(templateText);

            if (templateData.length === 0) throw new Error("Template is empty.");
            validateHeaders(Object.keys(templateData[0]), REQUIRED_TEMPLATE_HEADERS, "Template");

            // Build sets for quick matching
            const personIdSet = new Set(templateData.map(r => (r.PersonID || '').trim().toLowerCase()));
            const authorIdSet = new Set(templateData.map(r => (r.AuthorID || '').trim().toLowerCase()));
            const emailSet = new Set(templateData.map(r => (r.EmailAddress || '').trim().toLowerCase()));

            // --- Load Data Files ---
            allDataRows = [];
            for (const file of dataInput.files) {
                const dataText = await readFileAsText(file);
                const rows = parseDelimitedFile(dataText);
                if (rows.length > 0) {
                    validateHeaders(Object.keys(rows[0]), REQUIRED_DATA_HEADERS, "Data");
                }
                allDataRows.push(...rows);
            }
            if (allDataRows.length === 0) throw new Error("No data rows found in data files.");

            // Start with original template rows
            const outputRows = [...templateData];
            let newCount = 0;
            let matchedCount = 0;

            // --- Compare and Append ---
            for (const row of allDataRows) {
                const personId = (row['Staff/student number'] || '').trim().toLowerCase();
                const authorId = (row['ORCID'] || '').trim().toLowerCase();
                const email = (row['Email'] || '').trim().toLowerCase();

                // If already exists → count as matched and skip
                if (personIdSet.has(personId) || authorIdSet.has(authorId) || emailSet.has(email)) {
                    matchedCount++;
                    continue;
                }

                // Otherwise, append new row
                const newRow = {
                    PersonID: row['Staff/student number'] || '',
                    FirstName: row['Name'] ? row['Name'].split(' ')[0] : '',
                    LastName: row['Name'] ? row['Name'].split(' ').slice(1).join(' ') : '',
                    OrganizationID: row['Department/School/Unit'] || '',
                    DocumentID: '',
                    "UT (Unique WOS ID)": '',
                    AuthorID: row['ORCID'] || '',
                    EmailAddress: row['Email'] || '',
                    OtherNames: '',
                    FormerInstitution: ''
                };

                outputRows.push(newRow);
                newCount++;

                // Update sets so duplicates from data are not re-added
                if (personId) personIdSet.add(personId);
                if (authorId) authorIdSet.add(authorId);
                if (email) emailSet.add(email);
            }

            displayResults(outputRows, newCount, matchedCount, allDataRows.length);
            resultSection.style.display = 'block';

            downloadCsvBtn.onclick = () => downloadCSV(outputRows);
            downloadExcelBtn.onclick = () => downloadExcel(outputRows);

        } catch (error) {
            showError(error.message);
        }
    });

    // --- Helpers ---
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                let text = e.target.result;
                if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                resolve(text);
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    function parseDelimitedFile(text) {
        const firstLine = text.split('\n')[0];
        const delimiter = firstLine.includes(',') ? ',' : '\t';

        const lines = text.trim().split('\n');
        if (!lines.length) return [];

        const headers = lines[0].split(delimiter).map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseDelimitedRow(lines[i], delimiter);
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = (values[idx] || '').trim();
            });
            rows.push(row);
        }
        return rows;
    }

    function parseDelimitedRow(row, delimiter) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            if (char === '"' && (i === 0 || row[i - 1] !== '\\')) {
                inQuotes = !inQuotes;
            } else if ((char === delimiter) && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    function validateHeaders(actualHeaders, requiredHeaders, fileType) {
        const missing = requiredHeaders.filter(h => !actualHeaders.includes(h));
        if (missing.length > 0) {
            throw new Error(`${fileType} file is missing required columns: ${missing.join(', ')}`);
        }
    }

    function displayResults(rows, newCount, matchedCount, totalDataRows) {
        if (rows.length === 0) {
            previewDiv.innerHTML = "<p>No results to display.</p>";
            return;
        }
        const headers = TEMPLATE_HEADERS;
        let table = `<table><thead><tr>`;
        headers.forEach(h => table += `<th>${escapeHtml(h)}</th>`);
        table += `</tr></thead><tbody>`;

        rows.forEach(row => {
            table += `<tr>`;
            headers.forEach(h => table += `<td>${escapeHtml(row[h] || '')}</td>`);
            table += `</tr>`;
        });
        table += `</tbody></table>`;

        previewDiv.innerHTML = table;

        const matchPercent = totalDataRows > 0 ? ((matchedCount / totalDataRows) * 100).toFixed(1) : 0;
        const newPercent = totalDataRows > 0 ? ((newCount / totalDataRows) * 100).toFixed(1) : 0;

        statsDiv.innerHTML = `
            <p>✅ Added <strong>${newCount}</strong> new rows (${newPercent}% of data rows).</p>
            <p>🔍 Matched <strong>${matchedCount}</strong> existing rows (${matchPercent}% of data rows).</p>
            <p>📊 Final total in template: <strong>${rows.length}</strong>.</p>`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function downloadCSV(rows) {
        if (rows.length === 0) return;
        const headers = TEMPLATE_HEADERS;
        let csv = headers.join(',') + '\n';
        rows.forEach(row => {
            csv += headers.map(h => `"${(row[h] || '').replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'populated_template.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function downloadExcel(rows) {
        if (rows.length === 0) return;
        if (typeof XLSX === 'undefined') {
            showError("⚠️ Excel export requires SheetJS. Downloading as CSV instead.");
            downloadCSV(rows);
            return;
        }
        const headers = TEMPLATE_HEADERS;
        const normalizedRows = rows.map(r => {
            const obj = {};
            headers.forEach(h => obj[h] = r[h] || '');
            return obj;
        });

        const ws = XLSX.utils.json_to_sheet(normalizedRows, { header: headers });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Results");
        XLSX.writeFile(wb, "populated_template.xlsx");
    }

    function showError(message) {
        alert("⚠️ Error: " + message);
        resultSection.style.display = 'block';
        previewDiv.innerHTML = `<div style="color:white; background:#d9534f; padding:10px; border-radius:5px; margin-bottom:15px;">
            <strong>Error:</strong> ${escapeHtml(message)}
        </div>`;
        statsDiv.innerHTML = "";
    }

    function clearResults() {
        previewDiv.innerHTML = "";
        statsDiv.innerHTML = "";
    }
});
