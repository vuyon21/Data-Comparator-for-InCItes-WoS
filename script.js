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

    const REQUIRED_TEMPLATE_HEADERS = ["PersonID", "AuthorID", "EmailAddress"];
    const AT_LEAST_ONE_OF_DATA = ["Email Addresses", "ORCIDs"];

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
            ensureContainsAll(Object.keys(templateData[0]), REQUIRED_TEMPLATE_HEADERS, "Template");

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
                    ensureContainsAtLeastOne(Object.keys(rows[0]), AT_LEAST_ONE_OF_DATA, "Data");
                }
                allDataRows.push(...rows);
            }
            if (allDataRows.length === 0) throw new Error("No data rows found in data files.");

            const outputRows = [...templateData];
            const matchedRows = [];
            const addedUfsRows = [];
            const seenKeys = new Set();

            // --- Process each data row ---
            for (const row of allDataRows) {
                const emailCandidates = extractEmails(row["Email Addresses"]);
                const orcidCandidates = extractOrcids(row["ORCIDs"]);
                const doiList = extractDois(row);
                const utList = extractUts(row);

                let matchedTemplateRows = [];
                emailCandidates.forEach(e => {
                    if (emailToTemplateRows[e]) matchedTemplateRows.push(...emailToTemplateRows[e]);
                });
                orcidCandidates.forEach(o => {
                    if (authorIdToTemplateRows[o]) matchedTemplateRows.push(...authorIdToTemplateRows[o]);
                });

                if (matchedTemplateRows.length > 0) {
                    const hadAnythingToAdd = (doiList.length > 0) || (utList.length > 0);
                    if (!hadAnythingToAdd) continue;

                    for (const baseRow of matchedTemplateRows) {
                        const identityKey = ((baseRow.EmailAddress || baseRow.AuthorID || baseRow.PersonID || '') + '').toLowerCase();

                        const pairs = pairDoisUts(doiList, utList);
                        for (const [doi, ut] of pairs) {
                            const key = `${identityKey}|${doi}|${ut}`;
                            if (seenKeys.has(key)) continue;

                            const newRow = { ...baseRow };
                            newRow.DocumentID = doi || '';
                            newRow["UT (Unique WOS ID)"] = ut || '';
                            outputRows.push(newRow);
                            matchedRows.push(newRow);
                            seenKeys.add(key);
                        }
                    }
                } else {
                    const ufsEmail = emailCandidates.find(e => e.endsWith("@ufs.ac.za"));
                    if (ufsEmail) {
                        const identityKey = (ufsEmail || orcidCandidates[0] || '').toLowerCase();
                        const pairs = pairDoisUts(doiList, utList);

                        if (pairs.length > 0) {
                            for (const [doi, ut] of pairs) {
                                const key = `${identityKey}|${doi}|${ut}`;
                                if (seenKeys.has(key)) continue;

                                const newRow = {
                                    PersonID: '',
                                    FirstName: '',
                                    LastName: '',
                                    OrganizationID: '',
                                    DocumentID: doi || '',
                                    "UT (Unique WOS ID)": ut || '',
                                    AuthorID: orcidCandidates[0] || '',
                                    EmailAddress: ufsEmail,
                                    OtherNames: '',
                                    FormerInstitution: ''
                                };
                                outputRows.push(newRow);
                                addedUfsRows.push(newRow);
                                seenKeys.add(key);
                            }
                        }
                    }
                }
            }

            // --- Clean out empty rows if author already has DOI/UT ---
            const grouped = {};
            outputRows.forEach(row => {
                const identity = (row.EmailAddress || row.AuthorID || '').toLowerCase();
                if (!grouped[identity]) grouped[identity] = [];
                grouped[identity].push(row);
            });

            let cleanedRows = [];
            Object.values(grouped).forEach(group => {
                const hasDOIorUT = group.some(r => (r.DocumentID && r.DocumentID !== '') || (r["UT (Unique WOS ID)"] && r["UT (Unique WOS ID)"] !== ''));
                if (hasDOIorUT) {
                    cleanedRows.push(...group.filter(r => (r.DocumentID && r.DocumentID !== '') || (r["UT (Unique WOS ID)"] && r["UT (Unique WOS ID)"] !== '')));
                } else {
                    cleanedRows.push(...group);
                }
            });

            // Replace outputRows with cleaned version
            outputRows.length = 0;
            outputRows.push(...cleanedRows);

            // Group rows together by author
            outputRows.sort((a, b) => {
                const idA = (a.EmailAddress || a.AuthorID || '').toLowerCase();
                const idB = (b.EmailAddress || b.AuthorID || '').toLowerCase();
                return idA.localeCompare(idB);
            });

            displayResults(outputRows, matchedRows, addedUfsRows);
            resultSection.style.display = 'block';

            downloadCsvBtn.onclick = () => downloadCSV(outputRows);
            downloadExcelBtn.onclick = () => downloadExcel(outputRows);

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
            headers.forEach((header, idx) => row[header] = (values[idx] || '').trim());
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

    function ensureContainsAll(actualHeaders, required, fileType) {
        const missing = required.filter(h => !actualHeaders.includes(h));
        if (missing.length > 0) throw new Error(`${fileType} file is missing required columns: ${missing.join(', ')}`);
    }

    function ensureContainsAtLeastOne(actualHeaders, options, fileType) {
        const present = options.some(h => actualHeaders.includes(h));
        if (!present) throw new Error(`${fileType} file must contain at least one of: ${options.join(', ')}`);
    }

    function extractEmails(val) {
        if (!val) return [];
        return val.split(';').map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
    }

    function extractOrcids(val) {
        if (!val) return [];
        const re = /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g;
        return Array.from(new Set((val.match(re) || []).map(x => x.toLowerCase())));
    }

    function extractDois(rowObj) {
        const candidates = [];
        const knownHeaders = ["DOI", "DoI", "DOIs", "DI"];
        knownHeaders.forEach(h => { if (rowObj[h]) candidates.push(rowObj[h]); });
        const allText = Object.values(rowObj).join(' ; ');
        if (allText) candidates.push(allText);
        const doiRe = /\b10\.\d{4,9}\/[^\s";,<>]+/gi;
        const out = new Set();
        for (const chunk of candidates) {
            const m = chunk.match(doiRe);
            if (m) m.forEach(v => out.add(cleanTail(v)));
        }
        return Array.from(out);
    }

    function extractUts(rowObj) {
        const values = [];
        const likelyHeaders = ["UT (Unique WOS ID)", "UT", "Accession Number", "WOS ID", "WoS ID"];
        likelyHeaders.forEach(h => { if (rowObj[h]) values.push(rowObj[h]); });
        const allText = Object.values(rowObj).join(' ; ');
        if (allText) values.push(allText);
        const out = new Set();
        const wosRe = /WOS:\d+/gi;
        for (const chunk of values) {
            const m = chunk.match(wosRe);
            if (m) m.forEach(v => out.add(v.toUpperCase()));
        }
        return Array.from(out);
    }

    function cleanTail(s) {
        return (s || '').replace(/[\s'")\];,:.]+$/g, '');
    }

    function pairDoisUts(dois, uts) {
        const uniqueDois = Array.from(new Set(dois));
        const uniqueUts = Array.from(new Set(uts));
        if (uniqueDois.length === 0 && uniqueUts.length === 0) return [];
        if (uniqueDois.length === 0) return uniqueUts.map(ut => ['', ut]);
        if (uniqueUts.length === 0) return uniqueDois.map(doi => [doi, '']);
        const pairs = [];
        uniqueDois.forEach((doi, i) => {
            const ut = uniqueUts[Math.min(i, uniqueUts.length - 1)];
            pairs.push([doi, ut]);
        });
        return pairs;
    }

    // ---------- UI ----------
    function displayResults(allRows, matchedRows, addedUfsRows) {
        if (allRows.length === 0) {
            previewDiv.innerHTML = "<p>No results to display.</p>";
            return;
        }
        const headers = TEMPLATE_HEADERS;
        let html = `
            <h3>🔗 Matched & Enriched Rows (${matchedRows.length})</h3>
            ${buildTable(matchedRows, headers)}
            <h3>🟢 New UFS-only Rows (${addedUfsRows.length})</h3>
            ${buildTable(addedUfsRows, headers)}
            <h3>📊 Final Combined Template (${allRows.length})</h3>
            ${buildTable(allRows, headers)}
        `;
        previewDiv.innerHTML = html;
        statsDiv.innerHTML = `
            <p>🔗 Enriched <strong>${matchedRows.length}</strong> rows with DOI/UT links from data file.</p>
            <p>🟢 Added <strong>${addedUfsRows.length}</strong> new UFS-only rows (@ufs.ac.za emails).</p>
            <p>📊 Final total rows in template: <strong>${allRows.length}</strong>.</p>`;
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

    function downloadCSV(rows) {
        if (!rows || rows.length === 0) return;
        const headers = TEMPLATE_HEADERS;
        let csv = headers.join(',') + '\n';
        rows.forEach(row => {
            csv += headers.map(h => `"${((row[h] || '') + '').replace(/"/g, '""')}"`).join(',') + '\n';
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
        if (!rows || rows.length === 0) return;
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
