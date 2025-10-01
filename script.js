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

    // Required columns
    const REQUIRED_TEMPLATE_HEADERS = ["PersonID", "AuthorID", "EmailAddress"];
    const REQUIRED_DATA_HEADERS = ["Name", "Email Addresses", "ORCIDs", "DOI", "UT (Unique WOS ID)", "Department/School/Unit", "Staff/student number"];

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

            // Build lookup maps
            const emailToTemplateRows = {};
            const authorIdToTemplateRows = {};
            templateData.forEach(row => {
                const email = (row.EmailAddress || '').trim().toLowerCase();
                const authorId = (row.AuthorID || '').trim().toLowerCase();
                if (email) {
                    if (!emailToTemplateRows[email]) emailToTemplateRows[email] = [];
                    emailToTemplateRows[email].push(row);
                }
                if (authorId) {
                    if (!authorIdToTemplateRows[authorId]) authorIdToTemplateRows[authorId] = [];
                    authorIdToTemplateRows[authorId].push(row);
                }
            });

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

            const outputRows = [...templateData];
            let matchedLinks = 0;
            let addedUfsRows = 0;

            // --- Compare and Enrich ---
            for (const row of allDataRows) {
                // Extract email candidates
                const emailCandidates = [];
                if (row['Email Addresses']) {
                    row['Email Addresses'].split(';').forEach(e => {
                        const email = e.trim().toLowerCase();
                        if (email && email.includes('@')) emailCandidates.push(email);
                    });
                }

                // Extract ORCID candidates
                const orcidCandidates = [];
                if (row['ORCIDs']) {
                    const matches = row['ORCIDs'].match(/\d{4}-\d{4}-\d{4}-\d{4}/g);
                    if (matches) orcidCandidates.push(...matches.map(m => m.toLowerCase()));
                }

                const doi = (row['DOI'] || '').trim();
                const ut = (row['UT (Unique WOS ID)'] || '').trim();

                // Collect matching template rows
                let matchedTemplateRows = [];
                emailCandidates.forEach(e => {
                    if (emailToTemplateRows[e]) matchedTemplateRows.push(...emailToTemplateRows[e]);
                });
                orcidCandidates.forEach(o => {
                    if (authorIdToTemplateRows[o]) matchedTemplateRows.push(...authorIdToTemplateRows[o]);
                });

                if (matchedTemplateRows.length > 0) {
                    // Enrich template rows
                    matchedTemplateRows.forEach(baseRow => {
                        const newRow = { ...baseRow };
                        newRow.DocumentID = doi || baseRow.DocumentID || '';
                        newRow["UT (Unique WOS ID)"] = ut || baseRow["UT (Unique WOS ID)"] || '';
                        outputRows.push(newRow);
                        matchedLinks++;
                    });
                } else {
                    // --- UFS-only rows: add new entry if ufs.ac.za email exists
                    const ufsEmail = emailCandidates.find(e => e.endsWith("@ufs.ac.za"));
                    if (ufsEmail) {
                        const newRow = {
                            PersonID: row['Staff/student number'] || '',
                            FirstName: row['Name'] ? row['Name'].split(' ')[0] : '',
                            LastName: row['Name'] ? row['Name'].split(' ').slice(1).join(' ') : '',
                            OrganizationID: row['Department/School/Unit'] || '',
                            DocumentID: doi,
                            "UT (Unique WOS ID)": ut,
                            AuthorID: orcidCandidates.length > 0 ? orcidCandidates[0] : '',
                            EmailAddress: ufsEmail,
                            OtherNames: '',
                            FormerInstitution: ''
                        };
                        outputRows.push(newRow);
                        addedUfsRows++;
                    }
                }
            }

            displayResults(outputRows, matchedLinks, addedUfsRows);
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

    function displayResults(rows, matchedLinks, addedUfsRows) {
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
        statsDiv.innerHTML = `
            <p>🔗 Enriched <strong>${matchedLinks}</strong> rows with DOI/UT links from data file.</p>
            <p>🟢 Added <strong>${addedUfsRows}</strong> new UFS-only rows (@ufs.ac.za emails).</p>
            <p>📊 Final total rows in template: <strong>${rows.length}</strong>.</p>`;
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
