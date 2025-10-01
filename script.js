document.addEventListener('DOMContentLoaded', function () {
    const fileInput = document.getElementById('templateFile'); // now only one file input
    const processBtn = document.getElementById('processBtn');
    const resultSection = document.getElementById('resultSection');
    const statsDiv = document.getElementById('stats');
    const previewDiv = document.getElementById('preview');
    const downloadCsvBtn = document.getElementById('downloadCsv');
    const downloadExcelBtn = document.getElementById('downloadExcel');
    const downloadButtons = document.getElementById('downloadButtons');

    let allRows = [];

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

    [fileInput].forEach(input => {
        input.addEventListener('change', () => {
            processBtn.disabled = !(fileInput.files.length > 0);
        });
    });

    processBtn.addEventListener('click', async () => {
        clearResults();
        try {
            const file = fileInput.files[0];
            const text = await readFileAsText(file);
            allRows = parseDelimitedFile(text);

            if (allRows.length === 0) throw new Error("File is empty.");

            // --- Clean, group, deduplicate ---
            const grouped = {};
            allRows.forEach(row => {
                const identity = (row.EmailAddress || row.AuthorID || '').toLowerCase();
                if (!identity) return;
                if (!grouped[identity]) grouped[identity] = [];
                grouped[identity].push(row);
            });

            let cleanedRows = [];
            const matchedRows = [];
            const seenKeys = new Set();

            Object.values(grouped).forEach(group => {
                const hasDOIorUT = group.some(r =>
                    (r.DocumentID && r.DocumentID !== '') ||
                    (r["UT (Unique WOS ID)"] && r["UT (Unique WOS ID)"] !== '')
                );

                if (hasDOIorUT) {
                    group.forEach(r => {
                        const doi = (r.DocumentID || '').trim();
                        const ut = (r["UT (Unique WOS ID)"] || '').trim();
                        const identityKey = (r.EmailAddress || r.AuthorID || '').toLowerCase();
                        const key = `${identityKey}|${doi}|${ut}`;
                        if (!seenKeys.has(key) && (doi || ut)) {
                            cleanedRows.push(r);
                            matchedRows.push(r);
                            seenKeys.add(key);
                        }
                    });
                } else {
                    cleanedRows.push(...group);
                }
            });

            // Group rows together by author
            cleanedRows.sort((a, b) => {
                const idA = (a.EmailAddress || a.AuthorID || '').toLowerCase();
                const idB = (b.EmailAddress || b.AuthorID || '').toLowerCase();
                return idA.localeCompare(idB);
            });

            // Build Gaps report
            const gapsRows = getAuthorsWithoutDOIorUT(cleanedRows);

            displayResults(cleanedRows, matchedRows, gapsRows);
            resultSection.style.display = 'block';

            downloadCsvBtn.onclick = () => downloadCSV(cleanedRows, "cleaned_template.csv");
            downloadExcelBtn.onclick = () => downloadExcel(cleanedRows, "cleaned_template.xlsx");

            // Gaps buttons
            if (gapsRows.length > 0) {
                let downloadGapsCsvBtn = document.getElementById("downloadGapsCsv");
                let downloadGapsExcelBtn = document.getElementById("downloadGapsExcel");

                if (!downloadGapsCsvBtn) {
                    downloadGapsCsvBtn = document.createElement("button");
                    downloadGapsCsvBtn.id = "downloadGapsCsv";
                    downloadGapsCsvBtn.textContent = "📥 Download Gaps as CSV";
                    downloadButtons.appendChild(downloadGapsCsvBtn);
                }
                if (!downloadGapsExcelBtn) {
                    downloadGapsExcelBtn = document.createElement("button");
                    downloadGapsExcelBtn.id = "downloadGapsExcel";
                    downloadGapsExcelBtn.textContent = "📥 Download Gaps as Excel";
                    downloadButtons.appendChild(downloadGapsExcelBtn);
                }

                downloadGapsCsvBtn.onclick = () => downloadCSV(gapsRows, "gaps_report.csv");
                downloadGapsExcelBtn.onclick = () => downloadExcel(gapsRows, "gaps_report.xlsx");
            }

        } catch (error) {
            showError(error.message);
        }
    });

    // ---------- Helper functions ----------

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                let text = e.target.result;
                if (text && text.length && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                resolve(text);
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    function parseDelimitedFile(text) {
        const firstLine = (text.split('\n')[0] || '');
        const delimiter = firstLine.includes(',') ? ',' : '\t';
        const lines = text.trim().split('\n');
        if (!lines.length) return [];
        const headers = splitRow(lines[0], delimiter).map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = splitRow(lines[i], delimiter);
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = (values[idx] || '').trim();
            });
            rows.push(row);
        }
        return rows;
    }

    function splitRow(row, delimiter) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < row.length; i++) {
            const ch = row[i];
            if (ch === '"' && (i === 0 || row[i - 1] !== '\\')) {
                inQuotes = !inQuotes;
            } else if (ch === delimiter && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current);
        return result;
    }

    function getAuthorsWithoutDOIorUT(rows) {
        const grouped = {};
        rows.forEach(row => {
            const identity = (row.EmailAddress || row.AuthorID || '').toLowerCase();
            if (!grouped[identity]) grouped[identity] = [];
            grouped[identity].push(row);
        });
        const out = [];
        Object.values(grouped).forEach(group => {
            const hasDOIorUT = group.some(r =>
                (r.DocumentID && r.DocumentID !== '') ||
                (r["UT (Unique WOS ID)"] && r["UT (Unique WOS ID)"] !== '')
            );
            if (!hasDOIorUT) out.push(...group);
        });
        return out;
    }

    function displayResults(allRows, matchedRows, gapsRows) {
        if (allRows.length === 0) {
            previewDiv.innerHTML = "<p>No results to display.</p>";
            return;
        }
        const headers = TEMPLATE_HEADERS;

        let html = `
            <h3>🔗 Matched & Enriched Rows (${matchedRows.length})</h3>
            ${buildTable(matchedRows, headers)}
            <h3>⚠️ Authors without DOI/UT (${gapsRows.length})</h3>
            ${buildTable(gapsRows, headers)}
            <h3>📊 Final Cleaned Template (${allRows.length})</h3>
            ${buildTable(allRows, headers)}
        `;
        previewDiv.innerHTML = html;

        statsDiv.innerHTML = `
            <p>🔗 Enriched rows (with DOI/UT): <strong>${matchedRows.length}</strong></p>
            <p>⚠️ Authors still without DOI/UT: <strong>${gapsRows.length}</strong></p>
            <p>📊 Final total rows in file: <strong>${allRows.length}</strong></p>
        `;
    }

    function buildTable(rows, headers) {
        if (!rows || rows.length === 0) return "<p>No rows.</p>";
        let table = `<table><thead><tr>`;
        headers.forEach(h => table += `<th>${escapeHtml(h)}</th>`);
        table += `</tr></thead><tbody>`;
        rows.forEach(row => {
            table += `<tr>`;
            headers.forEach(h => table += `<td>${escapeHtml(row[h] || '')}</td>`);
            table += `</tr>`;
        });
        table += `</tbody></table>`;
        return table;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : text;
        return div.innerHTML;
    }

    function downloadCSV(rows, filename) {
        if (!rows || rows.length === 0) return;
        const groupedRows = [...rows].sort((a, b) => {
            const idA = (a.EmailAddress || a.AuthorID || '').toLowerCase();
            const idB = (b.EmailAddress || b.AuthorID || '').toLowerCase();
            return idA.localeCompare(idB);
        });
        const headers = TEMPLATE_HEADERS;
        let csv = headers.join(',') + '\n';
        groupedRows.forEach(row => {
            csv += headers.map(h => `"${((row[h] || '') + '').replace(/"/g, '""')}"`).join(',') + '\n';
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function downloadExcel(rows, filename) {
        if (!rows || rows.length === 0) return;
        if (typeof XLSX === 'undefined') {
            showError("⚠️ Excel export requires SheetJS. Downloading as CSV instead.");
            downloadCSV(rows, filename.replace(".xlsx", ".csv"));
            return;
        }
        const groupedRows = [...rows].sort((a, b) => {
            const idA = (a.EmailAddress || a.AuthorID || '').toLowerCase();
            const idB = (b.EmailAddress || b.AuthorID || '').toLowerCase();
            return idA.localeCompare(idB);
        });
        const headers = TEMPLATE_HEADERS;
        const normalizedRows = groupedRows.map(r => {
            const obj = {};
            headers.forEach(h => obj[h] = r[h] || '');
            return obj;
        });
        const ws = XLSX.utils.json_to_sheet(normalizedRows, { header: headers });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Results");
        XLSX.writeFile(wb, filename);
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
