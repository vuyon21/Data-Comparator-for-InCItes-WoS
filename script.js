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
            templateData = parseCSV(templateText);

            // Load all data files
            allDataRows = [];
            for (const file of dataInput.files) {
                const data = await readFileAsText(file);
                const rows = parseCSV(data);
                allDataRows.push(...rows);
            }

            // Normalize columns
            templateData = templateData.map(row => normalizeRow(row));
            allDataRows = allDataRows.map(row => normalizeRow(row));

            // Build mapping: (AuthorID, EmailAddress) -> [indices]
            const mapping = {};
            templateData.forEach((row, idx) => {
                const key = `${row.AuthorID}||${row.EmailAddress}`;
                if (!mapping[key]) mapping[key] = [];
                mapping[key].push(idx);
            });

            // Output rows
            const outputRows = [];

            // Process each data row
            allDataRows.forEach(dataRow => {
                const authorId = dataRow.AuthorID || '';
                const email = dataRow.EmailAddress || '';
                const doi = dataRow.DocumentID || dataRow.DOI || '';
                const ut = dataRow['UT (Unique WOS ID)'] || '';

                const key = `${authorId}||${email}`;

                if (mapping[key]) {
                    // Match found → duplicate template row for each match
                    mapping[key].forEach(idx => {
                        const newRow = { ...templateData[idx] };
                        newRow.DocumentID = doi;
                        newRow['UT (Unique WOS ID)'] = ut;
                        outputRows.push(newRow);
                    });
                } else {
                    // No match → create new row
                    outputRows.push({
                        PersonID: dataRow.PersonID || '',
                        FirstName: dataRow.FirstName || '',
                        LastName: dataRow.LastName || '',
                        OrganizationID: dataRow.OrganizationID || '',
                        DocumentID: doi,
                        AuthorID: authorId,
                        EmailAddress: email,
                        OtherNames: dataRow.OtherNames || '',
                        'UT (Unique WOS ID)': ut
                    });
                }
            });

            // Sort by AuthorID and DocumentID
            outputRows.sort((a, b) => {
                if (a.AuthorID !== b.AuthorID) return a.AuthorID.localeCompare(b.AuthorID);
                return a.DocumentID.localeCompare(b.DocumentID);
            });

            // Display results
            displayResults(outputRows);
            resultSection.style.display = 'block';

            // Setup download buttons
            downloadCsvBtn.onclick = () => downloadCSV(outputRows);
            downloadExcelBtn.onclick = () => downloadExcel(outputRows);

        } catch (error) {
            alert("Error processing files: " + error.message);
            console.error(error);
        }
    });

    // Helper: Read file as text (for CSV)
    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    // Helper: Parse CSV
    function parseCSV(text) {
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVRow(lines[i]);
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = values[idx] || '';
            });
            rows.push(row);
        }
        return rows;
    }

    // Handle quoted CSV fields
    function parseCSVRow(row) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            if (char === '"' && (i === 0 || row[i - 1] !== '\\')) {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    // Normalize row keys (ensure consistent field names)
    function normalizeRow(row) {
        const normalized = {};
        for (let key in row) {
            let cleanKey = key.trim();
            // Map variations
            if (cleanKey.toLowerCase().includes('documentid')) cleanKey = 'DocumentID';
            if (cleanKey.toLowerCase().includes('authorid')) cleanKey = 'AuthorID';
            if (cleanKey.toLowerCase().includes('email')) cleanKey = 'EmailAddress';
            if (cleanKey.toLowerCase().includes('personid')) cleanKey = 'PersonID';
            if (cleanKey.toLowerCase().includes('firstname')) cleanKey = 'FirstName';
            if (cleanKey.toLowerCase().includes('lastname')) cleanKey = 'LastName';
            if (cleanKey.toLowerCase().includes('organization')) cleanKey = 'OrganizationID';
            if (cleanKey.toLowerCase().includes('ut')) cleanKey = 'UT (Unique WOS ID)';
            normalized[cleanKey] = row[key];
        }
        return normalized;
    }

    // Display results in table
    function displayResults(rows) {
        if (rows.length === 0) {
            previewDiv.innerHTML = "<p>No results.</p>";
            return;
        }

        const headers = Object.keys(rows[0]);
        let table = `<table><thead><tr>`;
        headers.forEach(h => table += `<th>${h}</th>`);
        table += `</tr></thead><tbody>`;

        rows.forEach(row => {
            table += `<tr>`;
            headers.forEach(h => table += `<td>${row[h] || ''}</td>`);
            table += `</tr>`;
        });
        table += `</tbody></table>`;

        previewDiv.innerHTML = table;
        statsDiv.innerHTML = `<p>📊 Processed ${rows.length} rows from ${dataInput.files.length} data files.</p>`;
    }

    // Download as CSV
    function downloadCSV(rows) {
        if (rows.length === 0) return;
        const headers = Object.keys(rows[0]);
        let csv = headers.join(',') + '\n';
        rows.forEach(row => {
            csv += headers.map(h => `"${(row[h] || '').replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'matched_authors.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Download as Excel
    function downloadExcel(rows) {
        if (rows.length === 0) return;

        // Use SheetJS to convert to Excel
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Results");
        XLSX.writeFile(wb, "matched_authors.xlsx");
    }
});
