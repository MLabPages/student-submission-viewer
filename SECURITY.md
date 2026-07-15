# Security Policy

## Data handling

This application runs locally and binds only to `127.0.0.1`. Student submissions are not uploaded or transmitted to an external service. Preview PDFs, evaluations, and logs are stored under `%LOCALAPPDATA%\StudentSubmissionViewer` and are not part of the repository.

## Office documents

Office documents are opened read-only for conversion, with Office macro automation disabled. The **Open original** action launches the user's normal Office application; users should keep Protected View enabled and should not enable content from untrusted submissions.

## Reporting a vulnerability

Do not attach student submissions, names, evaluations, or other personal information to a public GitHub issue. Report only the minimum reproducible technical details.
