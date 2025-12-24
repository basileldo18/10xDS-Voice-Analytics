/*
 * GOOGLE APPS SCRIPT
 * Copy and paste this code into extensions > Apps Script in your Google Spreadsheet or Drive.
 */

// CONFIGURATION
// Replace this with your NGROK URL (e.g. https://1234.ngrok-free.app)
var SERVER_URL = "https://YOUR_NGROK_URL.ngrok-free.app/webhook/upload";
var FOLDER_ID = "YOUR_GOOGLE_DRIVE_FOLDER_ID";

function checkFolderForNewFiles() {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var files = folder.getFiles();

    // Create a property to store the last checked time
    var scriptProperties = PropertiesService.getScriptProperties();
    var lastChecked = scriptProperties.getProperty('LAST_CHECKED');
    var now = new Date().getTime();

    if (!lastChecked) {
        lastChecked = 0;
    }

    while (files.hasNext()) {
        var file = files.next();
        var createdDate = file.getDateCreated().getTime();

        // Only process files created since last check
        if (createdDate > lastChecked) {
            Logger.log("New file found: " + file.getName());
            sendFileToWebhook(file);
        }
    }

    // Update last checked time
    scriptProperties.setProperty('LAST_CHECKED', now.toString());
}

function sendFileToWebhook(file) {
    var payload = {
        "file": file.getBlob()
    };

    var options = {
        "method": "post",
        "payload": payload
    };

    try {
        var response = UrlFetchApp.fetch(SERVER_URL, options);
        Logger.log("Upload Success: " + response.getContentText());
    } catch (e) {
        Logger.log("Upload Failed: " + e.toString());
    }
}

function setupTrigger() {
    // Run every 1 minute
    ScriptApp.newTrigger("checkFolderForNewFiles")
        .timeBased()
        .everyMinutes(1)
        .create();
}
