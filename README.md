# 📊 Data Comparator for InCites & Web of Science

> A browser-based tool to match author publication data (DOIs, WOS IDs) using ORCID and Email Address.

---

## 🚀 Live Web App

🔗 **Use the tool here**:  
👉 [https://yourusername.github.io/Data-Comparator-for-InCites-WoS/](https://yourusername.github.io/Data-Comparator-for-InCites-WoS/)

*(Replace `yourusername` with your actual GitHub username if not done yet.)*

---

## 📌 What It Does

This tool helps you:

✅ Match author records from your **template file** with publication data from **multiple Web of Science/InCites CSV files**  
✅ Match by **AuthorID (ORCID)** + **EmailAddress**  
✅ Pull **DocumentID (DOI)** and **UT (Unique WOS ID)** into your template  
✅ **Duplicate rows** for authors with multiple publications  
✅ **Auto-create new rows** when ORCID matches but email is missing  
✅ **Download results** as CSV or Excel

All processing happens **in your browser** — no data is sent to any server.

---

## 📁 Files in This Repo

- `Template-ufs-people-documents.csv` — Your author template
- `data file 1.csv` to `data file 9.csv` — Your Web of Science/InCites data exports
- `index.html`, `script.js`, `style.css` — The web app that powers the matching

---

## 💡 How to Use

1. Go to the [Live App](https://yourusername.github.io/Data-Comparator-for-InCites-WoS/)
2. Upload `Template-ufs-people-documents.csv`
3. Upload one or more data files (`data file 1.csv`, etc.)
4. Click **“Process Files”**
5. Review results → Download as **CSV** or **Excel**

---

## 🛠️ Built With

- JavaScript (ES6+)
- HTML5 & CSS3
- No backend, no Python, no server — 100% client-side
- Hosted for free on **GitHub Pages**

---

## 📎 License

Free to use, modify, and distribute.  
© 2025 Your Name or Institution

---

> 💬 Need help or want to add features? Open an issue or contact the repo owner.
