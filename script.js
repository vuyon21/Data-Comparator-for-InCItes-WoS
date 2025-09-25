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

    // Enable button only when both files are selected
    [templateInput, dataInput].forEach(input => {
        input.addEventListener('change', () => {
            processBtn.disabled = !(templateInput.files.length > 0 && dataInput.files.length > 0);
        });
    });

    // Process files
    processBtn.addEventListener('click', async () => {
        try {
            // Load template
            const templateFile = templateInput.files[0];
            const templateText = await readFileAsText(templateFile);
            templateData = parseDelimitedFile(templateText);

            if (templateData.length === 0) throw new Error("Template is empty.");

            // Load ALL data files
            allDataRows = [];
            for (const file of dataInput.files) {
                const dataText = await readFileAsText(file);
                const rows = parseDelimitedFile(dataText);
                allDataRows.push(...rows.filter(row => 
                    (row['Email Addresses'] && row['Email Addresses'].trim()) || 
                    (row.ORCIDs && row.ORCIDs.trim())
                ));
            }

            if (allDataRows.length === 0) throw new Error("No valid data rows with email or ORCID found.");

            // Normalize columns in both datasets
            templateData = templateData.map(normalizeRow);
            allDataRows = allDataRows.map(normalizeRow);

            // Build mappings from template: by Email and by AuthorID
            const emailToTemplateIndices = {};
            const authorIdToTemplateIndices = {};

            templateData.forEach((row, idx) => {
                const email = (row.EmailAddress || '').trim().toLowerCase();
                const authorId = (row.AuthorID || '').trim().toLowerCase();

                if (email) {
                    if (!emailToTemplateIndices[email]) emailToTemplateIndices[email] = [];
                    emailToTemplateIndices[email].push(idx);
                }

                if (authorId) {
                    if (!authorIdToTemplateIndices[authorId]) authorIdToTemplateIndices[authorId] = [];
                    authorIdToTemplateIndices[authorId].push(idx);
                }
            });

            // Result container — start with ALL template rows
            const outputRows = [...templateData]; // 👈 Start with full template

            // For each data row, find matching template rows and append UTs
            for (const dataRow of allDataRows) {
                const email = (dataRow.EmailAddress || '').trim().toLowerCase();
                const authorId = (dataRow.AuthorID || '').trim().toLowerCase();
                const ut = (dataRow['UT (Unique WOS ID)'] || '').trim();

                if (!ut) continue; // Skip if no UT

                let matchedIndices = new Set();

                // Match by Email
                if (emailToTemplateIndices[email]) {
                    emailToTemplateIndices[email].forEach(idx => matchedIndices.add(idx));
                }

                // Match by AuthorID
                if (authorIdToTemplateIndices[authorId]) {
                    authorIdToTemplateIndices[authorId].forEach(idx => matchedIndices.add(idx));
                }

                if (matchedIndices.size > 0) {
                    // For each match, create a new row with updated UT
                    matchedIndices.forEach(idx => {
                        const newRow = { ...templateData[idx] };
                        newRow['UT (Unique WOS ID)'] = ut; // Only update UT
                        outputRows.push(newRow); // 👈 Append extra row for each UT
                    });
                }
                // If no match → do nothing (template row remains with empty UT)
            }

            if (outputRows.length === 0) throw new Error("No matches or data to output.");

            // Sort for readability: by Email, then by UT
            outputRows.sort((a, b) => {
                const emailA = (a.EmailAddress || '').toLowerCase();
                const emailB = (b.EmailAddress || '').toLowerCase();
                if (emailA !== emailB) return emailA.localeCompare(emailB);
                return (a['UT (Unique WOS ID)'] || '').localeCompare(b['UT (Unique WOS ID)'] || '');
            });

            // Display results
            displayResults(outputRows);
            resultSection.style.display = 'block';

            // Attach download handlers
            downloadCsvBtn.onclick = () => downloadCSV(outputRows);
            downloadExcelBtn.onclick = () => downloadExcel(outputRows);

        } catch (error) {
            alert("⚠️ Error: " + error.message);
            console.error(error);
        }
    });

    // --- Helper Functions ---

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                let text = e.target.result;
                // Remove BOM if present
                if (text.charCodeAt(0) === 0xFEFF) {
                    text = text.slice(1);
                }
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
            } else if ((char === ',' || char === '\t') && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    function normalizeRow(row) {
        const normalized = {};
        for (let key in row) {
            let cleanKey = key.trim();

            // Map your exact data file column names to standard keys
            if (cleanKey === "Email Addresses") {
                cleanKey = "EmailAddress";
            } else if (cleanKey === "ORCIDs") {
                cleanKey = "AuthorID";
            }
            // Keep "UT (Unique WOS ID)" as-is

            normalized[cleanKey] = row[key];
        }
        return normalized;
    }

    function displayResults(rows) {
        if (rows.length === 0) {
            previewDiv.innerHTML = "<p>No results to display.</p>";
            return;
        }

        const headers = [...new Set(rows.flatMap(Object.keys))];
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
        statsDiv.innerHTML = `<p>✅ Processed <strong>${rows.length}</strong> rows from <strong>${dataInput.files.length}</strong> data files.</p>`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function downloadCSV(rows) {
        if (rows.length === 0) return;
        const headers = [...new Set(rows.flatMap(Object.keys))];
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
            alert("⚠️ Excel export requires SheetJS. Downloading as CSV instead.");
            downloadCSV(rows);
            return;
        }

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Results");
        XLSX.writeFile(wb, "populated_template.xlsx");
    }
});
