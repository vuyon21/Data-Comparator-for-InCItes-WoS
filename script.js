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

    // Minimal required columns:
    // Matching needs at least one of Email OR ORCID present in the data.
    // We'll validate that at least one of these two exists; DOI/UT are optional to avoid false failures.
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

            // Build lookup maps for matching
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

            // Start with original template rows
            const outputRows = [...templateData];

            // Buckets for reporting
            const matchedRows = [];    // rows we added because we matched template + added DOI/UT
            const addedUfsRows = [];   // new rows from unmatched @ufs.ac.za

            // To avoid duplicate additions (same person + same DOI/UT)
            const seenKeys = new Set(); // key: identity|doi|ut

            // --- Process each data row ---
            for (const row of allDataRows) {
                // Extract candidates for matching
                const emailCandidates = extractEmails(row["Email Addresses"]);
                const orcidCandidates = extractOrcids(row["ORCIDs"]);

                // Robustly extract DOI(s) and UT(s) from the entire row object
                const doiList = extractDois(row);
                const utList = extractUts(row);

                // Collect matching template rows by email and/or ORCID
                let matchedTemplateRows = [];
                emailCandidates.forEach(e => {
                    if (emailToTemplateRows[e]) matchedTemplateRows.push(...emailToTemplateRows[e]);
                });
                orcidCandidates.forEach(o => {
                    if (authorIdToTemplateRows[o]) matchedTemplateRows.push(...authorIdToTemplateRows[o]);
                });

                // If we matched someone in the template, replicate identity and attach DOI/UT
                if (matchedTemplateRows.length > 0) {
                    // If we found no DOI/UT at all, skip enrichment for this data row
                    // (we still count enrichment ONLY when we actually add at least one DOI or UT).
                    const hadAnythingToAdd = (doiList.length > 0) || (utList.length > 0);
                    if (!hadAnythingToAdd) continue;

                    // For each matched base row, append rows for each DOI/UT found
                    for (const baseRow of matchedTemplateRows) {
                        const identityKey = ((baseRow.EmailAddress || baseRow.AuthorID || baseRow.PersonID || '') + '').toLowerCase();

                        const pairs = pairDoisUts(doiList, utList);
                        let addedForThisBase = 0;

                        for (const [doi, ut] of pairs) {
                            const key = `${identityKey}|${doi}|${ut}`;
                            if (seenKeys.has(key)) continue;

                            const newRow = { ...baseRow };
                            newRow.DocumentID = doi || '';
                            newRow["UT (Unique WOS ID)"] = ut || '';
                            outputRows.push(newRow);
                            matchedRows.push(newRow);
                            seenKeys.add(key);
                            addedForThisBase++;
                        }

                        // If there were no pairs (e.g., only one DOI or UT was empty array),
                        // ensure at least one enriched row if either DOI or UT exists.
                        if (addedForThisBase === 0 && hadAnythingToAdd) {
                            const doi = doiList[0] || '';
                            const ut = utList[0] || '';
                            const fallbackKey = `${identityKey}|${doi}|${ut}`;
                            if (!seenKeys.has(fallbackKey)) {
                                const newRow = { ...baseRow };
                                newRow.DocumentID = doi;
                                newRow["UT (Unique WOS ID)"] = ut;
                                outputRows.push(newRow);
                                matchedRows.push(newRow);
                                seenKeys.add(fallbackKey);
                            }
                        }
                    }
                } else {
                    // No match in template — if any @ufs.ac.za email exists, add new rows
                    const ufsEmail = emailCandidates.find(e => e.endsWith("@ufs.ac.za"));
                    if (ufsEmail) {
                        const identityKey = (ufsEmail || orcidCandidates[0] || '').toLowerCase();

                        const pairs = pairDoisUts(doiList, utList);
                        let addedAny = false;

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
                                addedAny = true;
                            }
                        } else {
                            // No DOI/UT found, but still add a single placeholder row with the identity
                            const key = `${identityKey}||`;
                            if (!seenKeys.has(key)) {
                                const newRow = {
                                    PersonID: '',
                                    FirstName: '',
                                    LastName: '',
                                    OrganizationID: '',
                                    DocumentID: '',
                                    "UT (Unique WOS ID)": '',
                                    AuthorID: orcidCandidates[0] || '',
                                    EmailAddress: ufsEmail,
                                    OtherNames: '',
                                    FormerInstitution: ''
                                };
                                outputRows.push(newRow);
                                addedUfsRows.push(newRow);
                                seenKeys.add(key);
                                addedAny = true;
                            }
                        }
                    }
                }
            }

            displayResults(outputRows, matchedRows, addedUfsRows);
            resultSection.style.display = 'block';

            downloadCsvBtn.onclick = () => downloadCSV(outputRows);
            downloadExcelBtn.onclick = () => downloadExcel(outputRows);

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
                if (text && text.length && text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
                resolve(text);
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    function parseDelimitedFile(text) {
        const firstLine = (text.split('\n')[0] || '');
        // prefer comma if present, else fall back to tab
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

    function ensureContainsAll(actualHeaders, required, fileType) {
        const missing = required.filter(h => !actualHeaders.includes(h));
        if (missing.length > 0) throw new Error(`${fileType} file is missing required columns: ${missing.join(', ')}`);
    }

    function ensureContainsAtLeastOne(actualHeaders, options, fileType) {
        const present = options.some(h => actualHeaders.includes(h));
        if (!present) throw new Error(`${fileType} file must contain at least one of: ${options.join(', ')}`);
    }

    // --- Extractors ---

    function extractEmails(emailFieldValue) {
        if (!emailFieldValue) return [];
        return emailFieldValue
            .split(';')
            .map(e => e.trim().toLowerCase())
            .filter(e => e && e.includes('@'));
    }

    function extractOrcids(orcidFieldValue) {
        if (!orcidFieldValue) return [];
        const re = /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g;
        const found = orcidFieldValue.match(re) || [];
        // normalize to lowercase for matching
        return Array.from(new Set(found.map(x => x.toLowerCase())));
    }

    function extractDois(rowObj) {
        // Check known DOI headers first (various spellings), then regex scan over all fields
        const candidates = [];
        const knownHeaders = ["DOI", "DoI", "DOIs", "DI", "Di", "di"];
        knownHeaders.forEach(h => {
            if (rowObj[h]) candidates.push(rowObj[h]);
        });
        // include whole row text for scanning
        const allText = Object.values(rowObj).join(' ; ');
        if (allText) candidates.push(allText);

        // RFC-ish DOI pattern (pragmatic)
        const doiRe = /\b10\.\d{4,9}\/[^\s";,<>]+/gi;
        const out = new Set();
        for (const chunk of candidates) {
            const m = chunk.match(doiRe);
            if (m) m.forEach(v => out.add(cleanTail(v)));
        }
        return Array.from(out);
    }

    function extractUts(rowObj) {
        // Look at likely headers then scan for WOS: patterns anywhere
        const values = [];
        const likelyHeaders = ["UT (Unique WOS ID)", "UT", "Accession Number", "WOS ID", "WoS ID", "UT_ID"];
        likelyHeaders.forEach(h => {
            if (rowObj[h]) values.push(rowObj[h]);
        });
        // scan everything
        const allText = Object.values(rowObj).join(' ; ');
        if (allText) values.push(allText);

        const out = new Set();

        // 1) canonical WOS: pattern
        const wosRe = /WOS:[A-Z0-9-]+/gi;
        for (const chunk of values) {
            const m = chunk.match(wosRe);
            if (m) m.forEach(v => out.add(cleanTail(v.toUpperCase())));
        }

        // 2) sometimes UT contains only the numeric part; we keep as-is if clearly UT-like (>= 8 digits)
        const utLooseRe = /\b\d{8,}\b/g;
        for (const chunk of values) {
            const m = chunk.match(utLooseRe);
            if (m) m.forEach(v => out.add(cleanTail(v)));
        }

        return Array.from(out);
    }

    function cleanTail(s) {
        // remove trailing punctuation like ; , . ) ]
        return (s || '').replace(/[\s'")\];,:.]+$/g, '');
    }

    // Pair DOI/UT lists sensibly:
    // - If both present, pair index-to-index, reusing last item when lengths differ
    // - If only one side present, return that side with empty for the other
    function pairDoisUts(dois, uts) {
        const d = dois || [];
        const u = uts || [];

        if (d.length === 0 && u.length === 0) return [];

        if (d.length === 0) {
            return u.map(ut => ['', ut]);
        }
        if (u.length === 0) {
            return d.map(doi => [doi, '']);
        }

        const n = Math.max(d.length, u.length);
        const pairs = [];
        for (let i = 0; i < n; i++) {
            pairs.push([ d[Math.min(i, d.length - 1)], u[Math.min(i, u.length - 1)] ]);
        }
        return pairs;
    }

    // ---------- UI rendering ----------

    function displayResults(allRows, matchedRows, addedUfsRows) {
        if (allRows.length === 0) {
            previewDiv.innerHTML = "<p>No results to display.</p>";
            return;
        }

        const headers = TEMPLATE_HEADERS;
        let html = `
            <div class="legend">
                <span><span class="legend-box legend-blue"></span> Matched & Enriched</span>
                <span><span class="legend-box legend-green"></span> New UFS-only</span>
                <span><span class="legend-box legend-gray"></span> Final Combined</span>
            </div>
        `;

        // Matched table
        html += `<h3>🔗 Matched & Enriched Rows (${matchedRows.length})</h3>`;
        html += buildTable(matchedRows, headers, "matched-table");

        // Added UFS rows table
        html += `<h3>🟢 New UFS-only Rows (${addedUfsRows.length})</h3>`;
        html += buildTable(addedUfsRows, headers, "ufs-table");

        // Final combined table
        html += `<h3>📊 Final Combined Template (${allRows.length})</h3>`;
        html += buildTable(allRows, headers, "final-table");

        previewDiv.innerHTML = html;

        statsDiv.innerHTML = `
            <p>🔗 Enriched <strong>${matchedRows.length}</strong> rows with DOI/UT links from data file.</p>
            <p>🟢 Added <strong>${addedUfsRows.length}</strong> new UFS-only rows (@ufs.ac.za emails).</p>
            <p>📊 Final total rows in template: <strong>${allRows.length}</strong>.</p>`;
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
