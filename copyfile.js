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

// command input
var oldOwner = process.argv[2];
var newOwner = process.argv[3];

if (!oldOwner){
    printUsage();
    process.exit(1);
}

// job queues
//var listed = []; // jobs with no "GDCOPY_"
var jobs = []; // jobs with "GDCOPY_"

// create workers
var listFree = true;
var workerCount = 1;
try{
    workerCount = parseInt(process.argv[4]);
    if(isNaN(workerCount)){ workerCount = 1 };
}catch(err){}
var workerWait = 500;
var listeners = [];

for (var i = 0; i< workerCount; i++){

    var jobListener = new eventEmitter();
    jobListener['name'] = 'worker_' + i;
    jobListener['free'] = true;

    jobListener.on('handleJob',handleJob);
    listeners.push(jobListener);
}


function printUsage(){

    var out = "Usgae: " + process.argv[1] + " [Old owner's mail address]";

    console.log(out);
}

var statusList = [
    {status:"LISTED", prefix:"GDCOPY_SRC#LISTED"},
    {status:"COPIED", prefix:"GDCOPY_SRC#COPIED"},
    {status:"SET_PERMISSION", prefix:"GDCOPY_SRC#SET_PERMISSION"},
    {status:"CH_OWNER", prefix:"GDCOPY_SRC#CH_OWNER"},
    {status:"RM_PERMISSION", prefix:"GDCOPY_SRC#RM_PERMISSION"},
    {status:"DONE", prefix:"GDCOPY_DONE_SRC#DONE"},
    {status:"DST", prefix:"GDCOPY_DST"},
];

function getStatus(title){
    for(var i=0; i < statusList.length; i++){
        var o = statusList[i];
        var re = new RegExp('^'+o['prefix']);
        if (title.match(re)){
            return o['status'];
        }
    }
    return null;
}

function getPrefix(status){
    for(var i=0; i < statusList.length; i++){
        var o = statusList[i];
        if (o['status'] === status){
            return o['prefix'];
        }
    }
    return null;
}

function createJob(){
    var o = {
        srcTitle: null,
        oriTitle: null,
        srcFileId: null,
        dstFileId: null,
        status: null,
        oldOwner: null,
        newOwner: null,
        srcParents: [],
        srcPremissions: [],
    }

    return o;
}

// program starts
checkToken();

function checkToken(){

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

    //執行runWorker以驅動Worker工作

    runWorker();
}

function runWorker(){

    setInterval(countAndKick, workerWait);

    function countAndKick(){

        for (var i = 0; i< workerCount; i++){

            var work = listeners[i];

            work.emit('handleJob');

        }
    }
}

function handleJob(){
    var worker = this;
    if (!worker.free){
        return;
    }
    worker.free = false; // lock worker

    if (jobs.length === 0){
        logger.debug('listFileNew()');
        listFileNew();
        worker.free = true; // free the worker
        return;
    } 

    var job = jobs.shift();
    var fun = handleStatus[job['status']];
    if (fun){
        fun(worker, job);
    }


}

// if job list empty, find raw files 
function checkJob(worker){

}

// if listed list empty, find files to the queue
function checkListedFile(worker){

    var listedFile = listed.pop();

    if(!listedFile){

    }

    return;
}

function listFileNew(){
    if (!listFree){
        return;
    }
    listFree = false; // lock list file function
    var folder = '"application/vnd.google-apps.folder"';

    //var query = '"' + oldOwner +'"' + ' in owners and mimeType != ' + folder + 
    //    ' and title contains "GDCOPY_SRC" and not title contains "GDCOPY_DONE_SRC-DONE"';

    var query = '"' + oldOwner +'"' + ' in owners and mimeType != ' + folder + 
        ' and not title contains "GDCOPY_"';
    drive.files.list({q:query, maxResults: workerCount },queryFile);

    function queryFile(err,files){

        console.log('Searching Files.....');

        if (err){

            if (err['code'] === 401){
                logger.error('Invalid Credentials!');
                process.exit(401);
            }

            logger.error(err);
            return;
        }

        // create the first status of jobs to the job list
        var fileList = files.items;
        //logger.debug(JSON.stringify(fileList, null, 2));
        var names = [];
        for (var i = 0; i < fileList.length; i++){
            var f = fileList[i];
            var job = createJob();
            job['srcFileId'] = f['id'];
            job['oriTitle'] = f['title'];
            job['status'] = 'NEW';
            jobs.push(job);

            names.push(f['id'] + '#' + f['title']);

        }

        logger.debug(names);
        listFree = true;

    }



}

function _renameFile(fileId, title, cb){
    var opt = {
        fileId: fileId,
        resource:{
            title: title,
        }
    }
    drive.files.patch(opt, function(err,file){
        if (err){
            cb(err)
            return;
        }
        cb(null, file)
        return;

    })

}

function _listPermission(fileId, cb){
    var opt = {
        fileId: fileId,
    }
    drive.permissions.list(opt, function(err,result){
        if (err){
            cb(err)
            return;
        }
        cb(null, result)
        return;

    })

}
function _updatePermission(fileId, cb){
    var opt = {
        fileId: fileId,
    }
    drive.permissions.list(opt, function(err,result){
        if (err){
            cb(err)
            return;
        }
        cb(null, result)
        return;

    })

}

function markFileListed(worker, job){
    worker['free'] = false;

    _renameFile(job['srcFileId'], getPrefix('LISTED') + '#' + job['srcFileId']+ '#NULL#' + job['oriTitle'], function(err, file){
        if (err){
            logger.error('markListed error:', err); 
            worker.free = true;
            return;
        }
        job['srcTitle'] = file['title']
        job['status'] = getStatus(file['title']);
        logger.debug('markListed successed!', job);

        jobs.push(job);
        logger.warn(jobs);
        worker['free'] = true;
        return;

    })
}

function cloneNewFile(worker, job){
    worker['free'] = false;
    logger.debug(worker.name, 'cloneNewFile()', JSON.stringify(job));
    drive.parents.list({fileId:job['srcFileId']}, function(err, result){
        if (err){
            logger.error(worker.name, err);
            worker['free'] = true;
            return;
        }
        logger.debug(worker.name, result);
        copyFile(result.items);
    });

    function copyFile(parents){
        var opt = {
            fileId: job['srcFileId'],
            resource:{
                title: getPrefix('DST') + '#' + job['oriTitle'],
                parents: parents,
            }
        }

        logger.debug(opt);
        drive.files.copy(opt, function(err, result){
            if (err){
                logger.error(worker.name, 'copyfile', err);
                worker['free'] = true;
                return;
            }
            logger.debug(worker.name, 'copyfile', result);
            job['dstFileId'] = result['id'];
            rename()

        })
    }

    function rename(){
        var title = getPrefix('COPIED') + '#' + job['srcFileId']+ '#'+job['dstFileId']+'#' + job['oriTitle'];
        _renameFile(job['srcFileId'], title, function(err, file){
            if (err){
                logger.error('rename error:', err); 
                worker.free = true;
                return;
            }
            job['srcTitle'] = file['title']
            job['status'] = getStatus(file['title']);
            logger.debug('COPIED successed!', job);

            jobs.push(job);
            logger.warn(jobs);
            worker['free'] = true;
            return;

        })
    }

}

function setPermission(worker, job){
    worker['free'] = false;
    logger.debug(worker.name, 'setPermission()', JSON.stringify(job));
    _listPermission(job['srcFileId'], function(err, result){
        if (err){
            logger.error('listPermission error:', err); 
            worker.free = true;
            return;
        }
        logger.debug('listPermission OK', JSON.stringify(result.items, null, 2));
        /*
        var opt = {
            fileId: job['dstFileId'],
            resource:{
                premission: ,
            }
        }

        drive.permissions.patch()
       */

        jobs.push(job);
        logger.warn(jobs);
        worker['free'] = true;
        return;

    });
}
function changeOwner(worker, job){
    worker['free'] = false;
    logger.debug(worker.name, 'changeOwner()', JSON.stringify(job));
    jobs.push(job);
    logger.warn(jobs);
    worker['free'] = true;
}

function removePermission(worker, job){
    worker['free'] = false;
    logger.debug(worker.name, 'removePermission()', JSON.stringify(job));
    jobs.push(job);
    logger.warn(jobs);
    worker['free'] = true;
}
function markDone(worker, job){
    worker['free'] = false;
    logger.debug(worker.name, 'markDone()', JSON.stringify(job));
    jobs.push(job);
    logger.warn(jobs);
    worker['free'] = true;
}

var handleStatus = {
    'NEW': markFileListed,
    'LISTED': cloneNewFile,
    'COPIED': setPermission,
    'SET_PERMISSION': changeOwner,
    'CH_OWNER': removePermission,
    'RM_PERMISSION': markDone,

}