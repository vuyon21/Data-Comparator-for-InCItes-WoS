document.addEventListener('DOMContentLoaded', function () {
    const templateInput = document.getElementById('templateFile');
    const processBtn = document.getElementById('processBtn');
    const resultSection = document.getElementById('resultSection');
    const statsDiv = document.getElementById('stats');
    const previewDiv = document.getElementById('preview');
    const downloadCsvBtn = document.getElementById('downloadCsv');
    const downloadExcelBtn = document.getElementById('downloadExcel');
    const downloadButtonsDiv = document.getElementById('downloadButtons');

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

    templateInput.addEventListener('change', () => {
        processBtn.disabled = !(templateInput.files.length > 0);
    });

    processBtn.addEventListener('click', async () => {
        clearResults();
        try {
            const templateFile = templateInput.files[0];
            const text = await readFileAsText(templateFile);
            allRows = parseDelimitedFile(text);

            if (allRows.length === 0) throw new Error("File is empty.");

            // Deduplicate per author and sort
            const { cleanedRows, exactDuplicates } = groupAndClean(allRows);

            // Analyze authors
            const { duplicatesSameUT, multipleDifferentUT, noDOIorUT, withDOIorUT, totalAuthors } = analyzeAuthors(cleanedRows);

            // Display results
            displayResults(cleanedRows, duplicatesSameUT, multipleDifferentUT, noDOIorUT, matchedRows(cleanedRows), exactDuplicates);
            resultSection.style.display = 'block';

            // Hook up downloads
            downloadCsvBtn.onclick = () => downloadCSV(cleanedRows, "populated_template.csv");
            downloadExcelBtn.onclick = () => downloadExcel(cleanedRows, "populated_template.xlsx");

            // Add gap downloads dynamically
            if (noDOIorUT.length > 0) {
                const btnCsv = document.createElement("button");
                btnCsv.textContent = "📥 Download Gaps as CSV";
                btnCsv.onclick = () => downloadCSV(noDOIorUT, "authors_without_doi_ut.csv");

                const btnXlsx = document.createElement("button");
                btnXlsx.textContent = "📥 Download Gaps as Excel";
                btnXlsx.onclick = () => downloadExcel(noDOIorUT, "authors_without_doi_ut.xlsx");

                downloadButtonsDiv.appendChild(btnCsv);
                downloadButtonsDiv.appendChild(btnXlsx);
            }

            // Stats summary
            statsDiv.innerHTML = `
                <p>🔗 Publication rows with DOI/UT: <strong>${matchedRows(cleanedRows).length}</strong></p>
                <p>⚠️ Authors still without DOI/UT: <strong>${noDOIorUT.length}</strong></p>
                <p>👤 Total unique authors: <strong>${totalAuthors}</strong> 
                   (with DOI/UT: ${withDOIorUT.length}, without DOI/UT: ${noDOIorUT.length})</p>
                <p>❌ Exact duplicate rows removed: <strong>${exactDuplicates.length}</strong></p>
                <p>📊 Final total rows in file: <strong>${cleanedRows.length}</strong></p>
            `;

        } catch (error) {
            showError(error.message);
        }
    });

    // ---------- Helpers ----------

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

    // Deduplicate per author (AuthorID+Email) and DOI/UT
    function groupAndClean(rows) {
        const seen = new Set();
        const cleaned = [];
        const exactDuplicates = [];

        rows.forEach(r => {
            const authorKey = (r.AuthorID || '') + '|' + (r.EmailAddress || '');
            const docId = (r.DocumentID || '').trim();
            const ut = (r["UT (Unique WOS ID)"] || '').trim();
            const key = `${authorKey}|${docId}|${ut}`;

            if (!seen.has(key)) {
                seen.add(key);
                cleaned.push(r);
            } else {
                exactDuplicates.push(r);
            }
        });

        return {
            cleanedRows: cleaned.sort((a, b) => {
                const idA = (a.EmailAddress || a.AuthorID || '').toLowerCase();
                const idB = (b.EmailAddress || b.AuthorID || '').toLowerCase();
                return idA.localeCompare(idB);
            }),
            exactDuplicates
        };
    }

    function analyzeAuthors(rows) {
        const groups = {};
        rows.forEach(r => {
            const id = (r.AuthorID || '') + '|' + (r.EmailAddress || '');
            if (!groups[id]) groups[id] = [];
            groups[id].push(r);
        });

        const duplicatesSameUT = [];
        const multipleDifferentUT = [];
        const noDOIorUT = [];
        const withDOIorUT = [];

        Object.entries(groups).forEach(([id, group]) => {
            const uts = new Set(group.map(r => (r["UT (Unique WOS ID)"] || '').trim()).filter(Boolean));
            const dois = new Set(group.map(r => (r.DocumentID || '').trim()).filter(Boolean));

            if (uts.size === 0 && dois.size === 0) {
                noDOIorUT.push(group[0]);
            } else {
                withDOIorUT.push(group[0]);
                if (uts.size === 1 && group.length > 1) {
                    duplicatesSameUT.push(...group);
                } else if (uts.size > 1) {
                    multipleDifferentUT.push(...group);
                }
            }
        });

        return { 
            duplicatesSameUT, 
            multipleDifferentUT, 
            noDOIorUT, 
            withDOIorUT, 
            totalAuthors: Object.keys(groups).length 
        };
    }

    function matchedRows(rows) {
        return rows.filter(r => (r.DocumentID && r.DocumentID !== '') || (r["UT (Unique WOS ID)"] && r["UT (Unique WOS ID)"] !== ''));
    }

    function displayResults(allRows, duplicatesSameUT, multipleDifferentUT, noDOIorUT, enrichedRows, exactDuplicates) {
        const headers = TEMPLATE_HEADERS;
        let html = `
            <h3>🔁 Duplicate Authors with Same UT (${duplicatesSameUT.length})</h3>
            ${buildTable(duplicatesSameUT, headers, "dup-ut-table")}
            <h3>📚 Authors with Different UTs (${multipleDifferentUT.length})</h3>
            ${buildTable(multipleDifferentUT, headers, "multi-ut-table")}
            <h3>⚠️ Authors without DOI/UT (${noDOIorUT.length})</h3>
            ${buildTable(noDOIorUT, headers, "no-ut-table")}
            <h3>🔗 Matched & Enriched Rows (${enrichedRows.length})</h3>
            ${buildTable(enrichedRows, headers, "matched-table")}
            <h3>❌ Exact Duplicate Rows Removed (${exactDuplicates.length})</h3>
            ${buildTable(exactDuplicates, headers, "dup-exact-table")}
            <h3>📊 Final Combined Template (${allRows.length})</h3>
            ${buildTable(allRows, headers, "final-table")}
        `;
        previewDiv.innerHTML = html;
    }

    function buildTable(rows, headers, cssClass) {
        if (!rows || rows.length === 0) return "<p>No rows.</p>";
        let table = `<table class="${cssClass}"><thead><tr>`;
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
        downloadButtonsDiv.querySelectorAll("button:not(#downloadCsv):not(#downloadExcel)").forEach(btn => btn.remove());
    }
});
