# gdcopy
gdcopy is a mini project for copying the folders and files for ownership transfer on Google Drive. Thanks for the help of [dollars0427](https://github.com/dollars0427). She did a lot of studies for this project.

## Setup

### Google Developers Console
1. https://console.developers.google.com/
2. create a project for the tool  
3. APIs & auth -> APIs -> Google Apps APIs - Drive API -> Enable
4. Increate Per-user limit to 100 or above
5. APIs & auth -> APIs -> Credentials
6. OAuth -> Create new Client ID -> Installed application -> Other

### Configuration

1. make a copy of option.conf.sample to option.conf

2. fill in the CLIENT\_ID and CLIENT\_SECRET from the Google Developers Console
```json
{
"CLIENT_ID" : "THIS_IS_NOT_REAL.apps.googleusercontent.com",
"CLIENT_SECRET" : "THIS_IS_SECRET",
"REDIRECT_URL" : "urn:ietf:wg:oauth:2.0:oob",
"ACCESS_TYPE" : "offline",
"SCOPE" : "https://www.googleapis.com/auth/drive"
}
```

### Create OAuth token

1. run oauth.js. Then continue the oauth process and paste the code as the input. 
```bash
node oauth.js

Visit the url:  https://accounts.google.com/o/oauth2/auth?access_type=offline&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&response_type=code&client_id=573581311921-us64va41fglaaulfor1fpd7m6ecg060c.apps.googleusercontent.com&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob
Enter the code here:

```

2. file oauth.token will be created/overwritten.
