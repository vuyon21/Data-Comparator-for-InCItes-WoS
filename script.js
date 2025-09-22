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

            if (templateData.length === 0) {
                throw new Error("Template file is empty or invalid.");
            }

            // Load all data files
            allDataRows = [];
            for (const file of dataInput.files) {
                const dataText = await readFileAsText(file);
                const rows = parseCSV(dataText);
                if (rows.length > 0) {
                    allDataRows.push(...rows);
                }
            }

            if (allDataRows.length === 0) {
                throw new Error("No valid data found in uploaded files.");
            }

            // Normalize columns
            templateData = templateData.map(row => normalizeRow(row));
            allDataRows = allDataRows.map(row => normalizeRow(row));

            // Build mapping by EmailAddress (since AuthorID is empty in template)
            const emailMapping = {};
            templateData.forEach((row, idx) => {
                const email = (row.EmailAddress || '').toString().trim().toLowerCase();
                if (email && email !== '') {
                    if (!emailMapping[email]) emailMapping[email] = [];
                    emailMapping[email].push(idx);
                }
            });

            // Output rows
            const outputRows = [];

            // Process each data row
            allDataRows.forEach(dataRow => {
                const authorId = (dataRow.AuthorID || '').toString().trim();
                const email = (dataRow.EmailAddress || '').toString().trim().toLowerCase();
                const doi = (dataRow.DocumentID || dataRow.DOI || '').toString().trim();
                const ut = (dataRow['UT (Unique WOS ID)'] || '').toString().trim();

                // Match by email (ignore AuthorID since template doesn't have it)
                if (emailMapping[email] && email
