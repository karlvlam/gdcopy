var fs = require('fs');
var events = require('events');
var eventEmitter = require('events').EventEmitter;

var google = require('googleapis');
var promise = require('promised-io');

// logger to console

var log4js = require('log4js');
log4js.configure({
    appenders:[
        {type:'console'}],
        //replaceConsole:true
});

var logger = log4js.getLogger('gdcopy');

// include Google Drive related...
var OAuth2Client = google.auth.OAuth2;
var setting = JSON.parse(fs.readFileSync('option.conf', 'utf8'));
var drive = null;

//var oldOwner = "gdcopy01@nx2mo.com";
var oldOwner = "";

var filelist = [];
var funlist = [];
var permId = '';

// program starts

var chain = new promise.defer();
chain
.then(checkToken)
.then(getRunner)
.then(getFiles)
//.then(doCleanRoot)

chain.resolve();
function getRunner(){

    var p = new promise.defer();
    drive.about.get(function(err, result){
        if (err){
            logger.error('getRunner:', err);
            process.exit(1);
            return;
        }

        logger.info('runnerInfo:', result.user);
        oldOwner = result['user']['emailAddress'];
        runnerEmail = result['user']['emailAddress'];
        runnerPermId = result['user']['permissionId'];
        p.resolve();

    });

    return p;
}

function checkToken(){
    var p = new promise.defer();

    try{
        var oauth2Client = new OAuth2Client(setting.CLIENT_ID,setting.CLIENT_SECRET,setting.REDIRECT_URL);

        var getToken = fs.readFileSync('oauth.token','utf8');

        var token = JSON.parse(getToken);

        oauth2Client.setCredentials(token);
    }

    catch(err){

        logger.error(err.message);
        process.exit(1);

    }

    //讀取Token並置入Client後，傳回至Drive當中

    drive = google.drive({version:'v2',auth:oauth2Client});
    p.resolve()

    //執行runWorker以驅動Worker工作
    return p;

}



function getFiles(){
    var p = new promise.defer();
    //var query = '"' + oldOwner +'"' + ' in owners ';
    var folder = '"application/vnd.google-apps.folder"';
    var query = '"' + oldOwner +'"' + ' in owners '  + 
        ' and title contains "GDCOPY_DONE" ';

    //var query = '"' + oldOwner +'"' + ' in owners and mimeType != ' + folder + ' and "root" in parents ' ; 
    //var query = '"' + oldOwner +'"' + ' in owners and  "root" in parents  and mimeType = ' + folder  ; 
    //var query = '"' + oldOwner +'"' + ' in owners and  "root" in parents '; 
    console.log(query)
    drive.files.list({q:query, maxResults: 50 }, function (err,files){
    //drive.files.list({maxResults: 200}, function (err,files){

        console.log('Searching Files.....');

        if (err){

            if (err['code'] === 401){
                logger.error('Invalid Credentials!');
                process.exit(401);
            }

            logger.error(err);
            return;
        }

        //logger.debug(files);
        var fileList = files.items;
        var funList = [];
        console.log(fileList.length)
        for (var i = 0; i < fileList.length; i++){
            var f = fileList[i];
            funList.push(removeFile);

        }

        var seq = promise.seq(funList, {idx:0})

        function removeFile(opt){
            var p = promise.defer();
            var idx = opt['idx'];
            var f = fileList[idx];
            drive.files.delete({fileId: f['id']}, function(err, result){
                if (err){
                    logger.error('Delete Error: ', err);
                    p.resolve({idx: idx + 1});
                    return;
                }

                logger.info('Delete OK: ', f['title']);
                p.resolve({idx: idx + 1});
            })
            return p;

        }

        console.log(filelist.length)
        p.resolve();

    });

    return p;
}
function doCleanRoot(){
    logger.warn('doCleanRoot');
    var p = new promise.seq(funlist);
    return p;

}

function deleteRoot(){
    var p = new promise.defer();
    var f = filelist.pop();
    drive.parents.delete({fileId: f['id'], parentId: "root"}, function(err, result){
        if (err){
            logger.error(new Error(err));
            process.exit(1);
            return;
        }
        logger.info(f['title'], f['id']);
        logger.info(result);
        p.resolve();
        return;
    })
    
    return p;

}

