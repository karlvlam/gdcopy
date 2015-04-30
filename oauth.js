var google = require('googleapis');
var fs = require('fs');
var OAuth2Client = google.auth.OAuth2;
var setting = JSON.parse(fs.readFileSync('option.conf', 'utf8'));
var CLIENT_ID = setting.CLIENT_ID;
var CLIENT_SECRET = setting.CLIENT_SECRET;
var REDIRECT_URL = setting.REDIRECT_URL;

var oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

var readline = require('readline-sync');
var log4js = require('log4js');
log4js.configure({
    appenders:[
        {type:'console'}],
        replaceConsole:false
});

var apiErrorLogger = log4js.getLogger('error');
apiErrorLogger.setLevel('ERROR');

var infoLogger = log4js.getLogger('Info');
infoLogger.setLevel('INFO');

getAccessToken(oauth2Client);

function getAccessToken(oauth2Client) {
    var url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: 'https://www.googleapis.com/auth/drive'
    });

    console.log('Visit the url: ', url);

    //Get the Access Token then save it to a text file
    var code = readline.question('Enter the code here:');
    oauth2Client.getToken(code, function(err, tokens) {

        if(err){
            apiErrorLogger.error(err.message);
            process.exit(1);
        }

        fs.writeFileSync('token.saved',JSON.stringify(tokens));
        
        infoLogger.info("Get AccessToken Finished.");
    });
}
