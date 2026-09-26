# FedHealth robustness matrix 2026-09-26T11:24:26.483Z

Backend http://127.0.0.1:4000; inference http://127.0.0.1:8000. Every row is a live request; PASS = the expected status, a JSON error body, and never 500.
District names in this run use letters only (e2e district: "E2E District cacgajcgbbcecb").

| Area | Input | Expected | Got | API message (first 150 chars) | Result |
|---|---|---|---|---|---|
| HTTP | malformed JSON body | 400 | 400 | Malformed JSON body | PASS |
| HTTP | JSON `null` as body | 400 | 400 | Malformed JSON body | PASS |
| HTTP | JSON array as body | 400 | 400 | Expected object, received array | PASS |
| HTTP | text/plain body | 400 | 400 | patientRef is required | PASS |
| HTTP | body larger than 1 MB | 413 | 413 | Request body is too large | PASS |
| HTTP | unknown route | 404 | 404 | Not found | PASS |
| HTTP | wrong method (DELETE /predict) | 404 | 404 | Not found | PASS |
| Auth | no token | 401 | 401 | Missing bearer token | PASS |
| Auth | "Bearer garbage" | 401 | 401 | Invalid or expired token | PASS |
| Auth | Basic auth header | 401 | 401 | Missing bearer token | PASS |
| Auth | token signed with a different secret | 401 | 401 | Invalid or expired token | PASS |
| Auth | unsigned token (alg "none") | 401 | 401 | Invalid or expired token | PASS |
| Auth | expired access token | 401 | 401 | Invalid or expired token | PASS |
| Auth | MFA pre-auth token on a clinical route | 401 | 401 | Token is not a full access token | PASS |
| Auth | NIH official calls /predict | 403 | 403 | Missing permission(s): report:create, prediction:create | PASS |
| Auth | doctor opens Model Health | 403 | 403 | Missing permission(s): nih:dashboard | PASS |
| Auth | login email `' OR 1=1 --` | 400 | 400 | email: Invalid email | PASS |
| Auth | login with wrong password | 401 | 401 | Invalid credentials | PASS |
| Auth | register as admin | 400 | 400 | role: Invalid enum value. Expected 'doctor' / 'lab_tech' / 'nih_official' / 'ngo', received 'admin' | PASS |
| Auth | NIH official with a gmail address | 400 | 400 | NIH officials must register with an approved government email domain (got: gmail.com) | PASS |
| Auth | register an existing email | 409 | 409 | Already exists | PASS |
| Auth | password shorter than 8 | 400 | 400 | password: String must contain at least 8 character(s) | PASS |
| Auth | MFA code "abcdef" | 400 | 400 | code: code must be 6 digits | PASS |
| Auth | wrong 6-digit MFA code | 401 | 401 | Invalid code | PASS |
| Patient ref | empty | 400 | 400 | patientRef: Enter the pseudonymous patient reference | PASS |
| Patient ref | spaces only | 400 | 400 | patientRef: Enter the pseudonymous patient reference | PASS |
| Patient ref | CNIC 35202-1234567-1 | 400 | 400 | patientRef: This looks like a CNIC number; use the pseudonymous patient reference instead | PASS |
| Patient ref | CNIC without dashes | 400 | 400 | patientRef: This looks like a CNIC number; use the pseudonymous patient reference instead | PASS |
| Patient ref | mobile 0300-1234567 | 400 | 400 | patientRef: This looks like a phone number; use the pseudonymous patient reference instead | PASS |
| Patient ref | email | 400 | 400 | patientRef: Use the pseudonymous patient reference, not an email address | PASS |
| Patient ref | HTML <script> | 400 | 400 | patientRef: Patient reference may contain only letters, digits and . _ : - | PASS |
| Patient ref | SQL `x'; DROP TABLE lab_reports;--` | 400 | 400 | patientRef: Patient reference may contain only letters, digits and . _ : - | PASS |
| Patient ref | 129 characters | 400 | 400 | patientRef: Patient reference is too long (max 128 characters) | PASS |
| Patient ref | Urdu name | 400 | 400 | patientRef: Patient reference may contain only letters, digits and . _ : - | PASS |
| Patient ref | number 42 (not a string) | 400 | 400 | patientRef: Expected string, received number | PASS |
| CBC | cbc missing | 400 | 400 | cbc: cbc is required, e.g. {"HGB": 12.4} | PASS |
| CBC | cbc is an array | 400 | 400 | cbc: cbc must be an object, e.g. {"HGB": 12.4} | PASS |
| CBC | cbc is a string "HGB=12" | 400 | 400 | cbc: cbc must be an object, e.g. {"HGB": 12.4} | PASS |
| CBC | cbc {} (nothing measured) | 400 | 400 | At least one recognized CBC value is required | PASS |
| CBC | every value null | 400 | 400 | At least one recognized CBC value is required | PASS |
| CBC | HGB as string "12.4" | 400 | 400 | cbc.HGB: HGB must be a number, not the text "12.4" | PASS |
| CBC | HGB true (boolean) | 400 | 400 | cbc.HGB: HGB must be a number, not a boolean | PASS |
| CBC | HGB [12.4] (array) | 400 | 400 | cbc.HGB: HGB must be a number, not a list | PASS |
| CBC | HGB 1e309 (Infinity) | 400 | 400 | cbc.HGB: HGB must be a finite number | PASS |
| CBC | HGB -5 (negative) | 400 | 400 | HGB outside supported range 2..24 g/dL (got -5 after converting from g/dL); verify units/value | PASS |
| CBC | PLT 0 | 400 | 400 | PLT outside supported range 1..1500 10^3/uL (got 0 after converting from /mm3); verify units/value | PASS |
| CBC | HGB 1,000,000 | 400 | 400 | HGB outside supported range 2..24 g/dL (got 1000000 after converting from g/dL); verify units/value | PASS |
| CBC | NEUTp 101 % | 400 | 400 | NEUTp outside supported range 0..100 % (got 101 after converting from %); verify units/value | PASS |
| CBC | boundary HGB 2 and 24 g/dL (accepted) | 201 | 201 | ok | PASS |
| CBC | unknown field FOO | 400 | 400 | Unknown CBC field(s): FOO; the model uses only WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp | PASS |
| CBC | lower-case key "hgb" | 400 | 400 | Unknown CBC field(s): hgb; the model uses only WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp | PASS |
| CBC | key "__proto__" | 400 | 400 | Unknown CBC field(s): __proto__; the model uses only WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp | PASS |
| CBC | key "constructor" | 400 | 400 | Unknown CBC field(s): constructor; the model uses only WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp | PASS |
| CBC | non-model field PDW (not a model input) | 400 | 400 | Unknown CBC field(s): PDW; the model uses only WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp | PASS |
| Units | no units at all | 400 | 400 | Provide CBC values and declared units, or canonicalUnits: true | PASS |
| Units | unit missing for PLT | 400 | 400 | Declare the unit for PLT | PASS |
| Units | unit "" for HGB | 400 | 400 | units.HGB: the unit for HGB must be text such as "g/dL", not the text "" | PASS |
| Units | unit null for HGB | 400 | 400 | units.HGB: the unit for HGB must be text such as "g/dL", not null | PASS |
| Units | unit 5 (number) | 400 | 400 | units.HGB: the unit for HGB must be text such as "g/dL", not 5 | PASS |
| Units | WBC in mmol/L | 400 | 400 | Unsupported unit for WBC: mmol/L | PASS |
| Units | unit "g/dL; DROP TABLE" | 400 | 400 | Unsupported unit for HGB: g/dL; DROP TABLE | PASS |
| Units | unit 40 characters long | 400 | 400 | units.HGB: the unit for HGB is too long | PASS |
| Units | units for an unknown field | 400 | 400 | Units given for unknown field(s): FOO | PASS |
| Units | units as an array | 400 | 400 | units: units must be an object, e.g. {"HGB": "g/dL"} | PASS |
| Units | WBC 9010 declared ×10³/µL (count typed as 10³) | 400 | 400 | WBC outside supported range 0.5..200 10^3/uL (got 9010 after converting from 10^3/uL); verify units/value — 9010 would fit if the unit is /mm³ (count) (hint names /mm³) | PASS |
| Units | HCT 0.38 declared % (fraction typed) | 400 | 400 | HCT outside supported range 5..70 % (got 0.38 after converting from %); verify units/value — 0.38 would fit if the unit is L/L (hint names L/L) | PASS |
| Units | HGB 124 declared g/dL (g/L typed) | 400 | 400 | HGB outside supported range 2..24 g/dL (got 124 after converting from g/dL); verify units/value — 124 would fit if the unit is g/L | PASS |
| Units | canonicalUnits "yes" (string) | 400 | 400 | canonicalUnits: Expected boolean, received string | PASS |
| Units | canonicalUnits true with raw counts | 400 | 400 | WBC outside supported range 0.5..200 10^3/uL (got 9010 after converting from 10^3/uL); verify units/value — 9010 would fit if the unit is /mm³ (count) | PASS |
| Units | case/µ variants "G/DL", "x10³/µL" (accepted) | 201 | 201 | ok | PASS |
| Context | age -1 | 400 | 400 | ageYears: ageYears cannot be negative | PASS |
| Context | age 131 | 400 | 400 | ageYears: ageYears must be 130 or less | PASS |
| Context | age 12.5 | 400 | 400 | ageYears: ageYears must be a whole number | PASS |
| Context | age "30" (string) | 400 | 400 | ageYears: ageYears must be a whole number | PASS |
| Context | sex "female" | 400 | 400 | sex: sex must be 'M', 'F' or 'O' | PASS |
| Context | latitude 91 | 400 | 400 | latitude: Number must be less than or equal to 90 | PASS |
| Context | latitude without longitude | 400 | 400 | latitude: Send latitude and longitude together | PASS |
| Context | collectedAt "yesterday" | 400 | 400 | collectedAt: collectedAt must be a date | PASS |
| Context | collectedAt 2999-01-01 (future) | 400 | 400 | collectedAt: collectedAt is in the future | PASS |
| Context | collectedAt 1800-01-01 | 400 | 400 | collectedAt: collectedAt is before 1900 | PASS |
| Context | district "<b>Lahore</b>" | 400 | 400 | district: Use letters only for district/province names | PASS |
| Context | district 81 characters | 400 | 400 | district: String must contain at most 80 character(s) | PASS |
| Context | symptomsText 2001 characters | 400 | 400 | symptomsText: Symptom text is too long (max 2000 characters) | PASS |
| Context | extra field "diagnosis" | 400 | 400 | Unknown field(s): diagnosis | PASS |
| Context | labId "abc" | 400 | 400 | labId: labId must be a UUID | PASS |
| Context | model "gpt-4" | 400 | 400 | model: Invalid literal value, expected "cbc_multiclass" | PASS |
| Context | source "fax" | 400 | 400 | source: Invalid enum value. Expected 'manual' / 'ocr' / 'lims', received 'fax' | PASS |
| Context | labId: well-formed UUID of no lab | 400 | 400 | Referenced record does not exist | PASS |
| Data quality | HGB 2.4 with HCT 38, MCHC 33 (typo; in range) | 201 | 201 | ok (2 warnings returned) | PASS |
| IDs | POST /predictions/abc/confirm | 400 | 400 | id must be a UUID | PASS |
| IDs | POST /predictions/1' OR '1'='1/confirm | 400 | 400 | id must be a UUID | PASS |
| IDs | confirm a UUID that does not exist | 404 | 404 | prediction not found | PASS |
| IDs | GET /reports/xyz | 400 | 400 | id must be a UUID | PASS |
| IDs | POST /reports/<unknown uuid>/predict | 404 | 404 | report not found | PASS |
| IDs | GET /patients/<CNIC>/history | 400 | 400 | This looks like a CNIC number; use the pseudonymous patient reference instead | PASS |
| IDs | NIH ack /nih/alerts/xyz/ack | 400 | 400 | id must be a UUID | PASS |
| Confirm | condition "Leukemia" (wrong case) | 400 | 400 | confirmedCondition: Invalid enum value. Expected 'healthy' / 'anemia' / 'thalassemia' / 'leukemia', received 'Leukemia' | PASS |
| Confirm | old nine-class "iron_deficiency_anemia" | 400 | 400 | confirmedCondition: Invalid enum value. Expected 'healthy' / 'anemia' / 'thalassemia' / 'leukemia', received 'iron_deficiency_anemia' | PASS |
| Confirm | condition missing | 400 | 400 | confirmedCondition is required | PASS |
| Confirm | notes 2001 characters | 400 | 400 | notes: Notes are too long (max 2000 characters) | PASS |
| Confirm | extra field "confirmedBy" | 400 | 400 | Unknown field(s): confirmedBy | PASS |
| NIH | clusters?condition=cancer | 400 | 400 | condition: Invalid enum value. Expected 'healthy' / 'anemia' / 'thalassemia' / 'leukemia', received 'cancer' | PASS |
| NIH | alerts?limit=0 | 400 | 400 | limit: limit must be a whole number from 1 to 500 | PASS |
| NIH | alerts?limit=abc | 400 | 400 | limit: limit must be a whole number from 1 to 500 | PASS |
| NIH | alerts?limit=100000 | 400 | 400 | limit: limit must be a whole number from 1 to 500 | PASS |
| NIH | alerts?status=deleted | 400 | 400 | status: Invalid enum value. Expected 'open' / 'acknowledged' / 'resolved', received 'deleted' | PASS |
| Model Health | accuracy-history?run=abc | 400 | 400 | run: Invalid uuid | PASS |
| Model Health | accuracy-history?run=<unknown uuid> | 404 | 404 | federated run not found | PASS |
| Model Health | data-intake?days=-5 (clamped to 1) | 200 | 200 | ok | PASS |
| OCR | no image and no text | 400 | 400 | Upload an image (field "image") or send the report text (field "text") | PASS |
| OCR | text "" (empty) | 400 | 400 | Upload an image (field "image") or send the report text (field "text") | PASS |
| OCR | text 20,001 characters | 400 | 400 | report text is too long | PASS |
| OCR | text with no CBC values | 200 | 200 | ok (extractedCount 0) | PASS |
| OCR | PDF upload | 400 | 400 | Upload a PNG, JPEG, WebP or TIFF image of the report (PDFs: paste the text) | PASS |
| OCR | empty PNG (0 bytes) | 400 | 400 | Could not read the image (Input file contains unsupported image format); upload a PNG, JPEG, WebP or TIFF | PASS |
| OCR | text file renamed .png | 400 | 400 | Could not read the image (Input file contains unsupported image format); upload a PNG, JPEG, WebP or TIFF | PASS |
| OCR | truncated (corrupt) PNG | 400 | 400 | Could not read the image (pngload: end of stream); upload a PNG, JPEG, WebP or TIFF | PASS |
| OCR | 9 MB image | 413 | 413 | The image is larger than 8 MB | PASS |
| OCR | image in field "file" instead of "image" | 400 | 400 | Upload the report image in the field "image" | PASS |
| OCR | two images at once | 400 | 400 | Upload one report image at a time | PASS |
| OCR | lang "eng; rm -rf /" (command injection) | 400 | 400 | lang must be like "eng" or "eng+urd" | PASS |
| Symptoms | symptoms/parse with no text | 400 | 400 | text is required | PASS |
| Symptoms | symptoms/parse 2001 characters | 400 | 400 | text: String must contain at most 2000 character(s) | PASS |
| Inference | no API key | 401 | 401 | unauthorized | PASS |
| Inference | wrong API key | 401 | 401 | unauthorized | PASS |
| Inference | HGB "12.4" (string) | 400 | 400 | HGB must be a finite number | PASS |
| Inference | HGB true | 400 | 400 | HGB must be a finite number | PASS |
| Inference | HGB NaN (non-standard JSON) | 400 | 400 | HGB must be a finite number | PASS |
| Inference | unit 5 (number) | 400 | 400 | Unit for HGB must be a short text such as 'g/dL' | PASS |
| Inference | 70 KB body | 413 | 413 | Request body is too large | PASS |
| Inference | unknown route | 404 | 404 | The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again. | PASS |
| Inference | GET /infer (wrong method) | 405 | 405 | The method is not allowed for the requested URL. | PASS |
| DB | reports stored for this run's patient (only the 4 accepted requests) | 4 | 4 | | PASS |

**133 of 133 passed, 0 failed.**
