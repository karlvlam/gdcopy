var fs = require('fs');
var events = require('events');
var eventEmitter = require('events').EventEmitter;
var http = require('http');
http.globalAgent.maxSockets = 100;

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

var newOwnerPermId = null;
var runnerEmail = null;
var runnerPermId = null;

if (!oldOwner || !newOwner){
    printUsage();
    process.exit(1);
}
if (oldOwner === newOwner){
    logger.error('Both owner cannot be the same!');
    printUsage();
    process.exit(1);
}

// job queues
//var listed = []; // jobs with no "GDCOPY_"
var jobs = []; // jobs with "GDCOPY_"

// create workers
var listFree = true;
var workerCount = 1;
var reqCount = 1;
try{
    reqCount = parseInt(process.argv[4]);
    if(isNaN(reqCount)){ reqCount = 1 };
}catch(err){}
if (reqCount > 100){
    reqCount = 1;
}
var workerWait = 29;
var listeners = [];

for (var i = 0; i< workerCount; i++){

    var jobListener = new eventEmitter();
    jobListener['name'] = 'worker_' + i;
    jobListener['free'] = true;

    jobListener.on('handleJob',handleJob);
    listeners.push(jobListener);
}


function printUsage(){

    var out = "Usgae: " + process.argv[1] + " [OLD OWNER EMAIL] [NEW OWNER EMAIL] " ;

    console.log(out);
}

var statusList = [
    {status:"LISTED", prefix:"GDCOPY_DSRC#LISTED"},
    {status:"COPIED", prefix:"GDCOPY_DSRCD#COPIED"},
    {status:"SET_PERMISSION", prefix:"GDCOPY_DSRC#SET_PERMISSION"},
    {status:"ADD_PARENT", prefix:"GDCOPY_DSRC#ADD_PARENT"},
    {status:"CH_OWNER", prefix:"GDCOPY_DSRC#CH_OWNER"},
    {status:"RM_PARENT", prefix:"GDCOPY_DSRC#RM_PARENT"},
    {status:"DONE", prefix:"GDCOPY_DONE_DSRC#DONE"},
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
//checkToken();
var chain = new promise.defer();
chain
.then(checkToken)
.then(getRunner)
.then(getOwnerPermId)
.then(listFileInprogress)
.then(runWorker);
chain.resolve();

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


function lockWorker(worker){
    if (!worker['free']){
        return false;
    }
    worker['free'] = false;
    //logger.warn(worker.name, 'locked!')
    return true;
}
function freeWorker(worker){
    worker['free'] = true;
    return true;
}

function runWorker(){

    var p = new promise.defer();
    setInterval(countAndKick, workerWait);
    function countAndKick(){

        for (var i = 0; i< workerCount; i++){

            var worker = listeners[i];

            worker.emit('handleJob');
            //logger.warn(worker.name, 'emit handleJob');

        }
    }

    p.resolve()
    return p;
}

function handleJob(){
    var worker = this;
    if (!lockWorker(worker)){
        return;
    }

    var freeWorkerCount = 1; // this "free" worker counts one
    for (var i = 0; i< workerCount; i++){
        if(listeners[i]['free']){
            freeWorkerCount++;
        }

    }

    //logger.debug(worker.name, 'handleJob()');
    if (jobs.length === 0 && listFree && freeWorkerCount > 0){
        listFileNew(worker, freeWorkerCount);
        return;
    } 


    if (jobs.length === 0){
        freeWorker(worker);
        return;
    }
    var job = jobs.pop();
    var fun = handleStatus[job['status']];
    logger.warn(worker.name, job['status']);
    if (fun){
        fun(worker, job);
    }


}
function getRunner(){

    var p = new promise.defer();
    drive.about.get(function(err, result){
        if (err){
            logger.error('getRunner:', err);
            process.exit(1);
            return;
        }

        logger.info('runnerInfo:', result.user);
        runnerEmail = result['user']['emailAddress'];
        runnerPermId = result['user']['permissionId'];
        p.resolve();

    });

    return p;
}

function getOwnerPermId(){

    var p = new promise.defer();
    _getPermissionId(newOwner, function(err, result){
        if (err){
            logger.error('newOwnerPermId:', err);
            process.exit(1);
            return;
        }

        logger.debug(result);
        newOwnerPermId = result.id;
        logger.info('newOwnerPermId:', newOwnerPermId);
        p.resolve();
    });

    return p;
}

function listFileInprogress(){
    var p = new promise.defer();
    var folder = '"application/vnd.google-apps.folder"';
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

    function classifyJob(file){
        var job = createJob();
        job['srcFileId'] = file['id'];
        job['srcTitle'] = file['title'];

        var titles = file['title'].split("#");
        if (titles.length < 5){
            return null;
        }

        job['status'] = getStatus(file['title']);
        if (!job['status']){
            return null;
        }

        if (job['srcFileId'] !== titles[2]) {
            return null;
        }

        job['dstFileId'] = titles[3];

        job['oriTitle'] = "";
        for (var i=4; i < titles.length; i++){
            job['oriTitle'] += titles[i];
            if (i !== titles.length-1){
                job['oriTitle'] += "#";
            }
        }

        return job;

    }
    // search for WIP files
    var query = '"' + oldOwner +'"' + ' in owners and mimeType = ' + folder + 
        ' and title contains "GDCOPY_DSRC#" and not title contains "GDCOPY_DONE_DSRC#"';
    drive.files.list({q:query, maxResults: 10},queryFile);

    function queryFile(err,files){

        console.log('Searching WIP Folders.....');

        if (err){

            if (err['code'] === 401){
                logger.error('Invalid Credentials!');
                process.exit(401);
            }

            logger.error(err);
            return;
        }

        var fileList = files.items;
        var names = [];
        for (var i = 0; i < fileList.length; i++){
            var f = fileList[i];
            var job = classifyJob(f);
            if (job){
                jobs.push(job);
            }
            logger.warn(job);


        }

        logger.debug(names);
        listFree = true;
        p.resolve();

    }

    return p;
}


function listFileNew(worker, limit){
    if (!listFree){
        return;
    }
    listFree = false; // lock list file function
    logger.info(worker.name, 'listFileNew()', limit);
    var folder = '"application/vnd.google-apps.folder"';


    // skip "GDCOPY_" folders
    var query = '"' + oldOwner +'"' + ' in owners and mimeType = ' + folder + 
        ' and not title contains "GDCOPY_"';
    drive.files.list({q:query, maxResults: 1000},queryFile);

    function queryFile(err,files){

        console.log('Searching New Folders.....');

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
            // skip no parents folders
            if (f['parents'].length === 0){
                continue;
            }

            // create a new job with folder with parents
            var job = createJob();
            job['srcFileId'] = f['id'];
            job['oriTitle'] = f['title'];
            job['status'] = 'NEW';
            jobs.push(job);

            names.push(f['id'] + '#' + f['title']);
            break;

        }

        logger.debug(names);
        setTimeout(function(worker){
            listFree = true;
            freeWorker(worker);
        }, 10000, worker);

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

function _copyPermission(fileId, perm, cb){
    // skip non-user permission 
    if (!perm['emailAddress']){
        cb('NO_EMAIL');
        return;
    }
    // skip deleted users
    if (perm['emailAddress'] && perm['emailAddress'] === ''){
        cb('NO_USER');
        return;
    }

    if (perm['id'] === 'anyoneWithLink'){
        cb('SHARE_LINK');
        return;
    }

    // skip owner
    if (!(perm['role'] === 'writer' || perm['role'] === 'reader') ){
        cb('OWNER');
        return;
    }

    // skip types other then 
    if (!(perm['type'] === 'user' || perm['type'] === 'group') ){
        cb('SKIP_TYPE');
        return;
    }
    var opt = {
        fileId: fileId,
        sendNotificationEmails:false,
        permissionId: perm['id'],
        resource: {
            role: perm['role'],
            type: perm['type'],
            id: perm['id'],
        },

    }
    if (perm['additionalRoles']){
        opt['resource']['additionalRoles'] = perm['additionalRoles'];
    }

    drive.permissions.insert(opt, function(err, result){
        if (err){
            cb(err);
        }
        //logger.debug(result);
        _patchPermission();
    });

    function _patchPermission(){
        drive.permissions.patch(opt, function(err, result){
            if (err){
                cb(err);
                return;
            }
            cb(null, result);
        });
    };

}

function _deletePermission(fileId, perm, cb){
    // skip non-user permission 
    if (!perm['emailAddress']){
        cb('NO_EMAIL');
        return;
    }

    // skip owner
    if (!(perm['role'] === 'writer' || perm['role'] === 'reader') ){
        cb('OWNER');
        return;
    }
    if (perm['id'] === runnerPermId){
        cb('RUNNER_ID');
        return;
    }

    var opt = {
        fileId: fileId,
        permissionId: perm['id'],
    }

    drive.permissions.delete(opt, function(err, result){
        if (err){
            cb(err);
            return;
        }
        cb(null, result);
    });

}



function _getPermissionId(email, cb){
    var opt = {
        email: email,
    }
    drive.permissions.getIdForEmail(opt, function(err,result){
        if (err){
            cb(err)
            return;
        }
        if (result.id.match(/i$/)){
            cb('INVALID_EMAIL');
            return;
        }
        cb(null, result)
        return;

    })

}
function _changeOwner(fileId, ownerPermId, cb){
    var opt = {
        fileId: fileId,
        sendNotificationEmails:false,
        permissionId: ownerPermId,
        resource: {
            role: 'owner',
            type: 'user',
            id: ownerPermId,
        },

    }

    drive.permissions.insert(opt, function(err, result){
        if (err){
            cb(err);
            return;
        }
        cb(null, result);
    });

}

function markFileListed(worker, job){
    lockWorker(worker);

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
        freeWorker(worker);
        return;

    })
}

function createNewFolder(worker, job){
    lockWorker(worker);
    logger.debug(worker.name, 'createNewFolder()', JSON.stringify(job));
    var chain = new promise.defer();
    chain
    .then(getParents)
    .then(makeFolder)
    .then(rename);
    chain.resolve();

    function getParents(){

        var p = new promise.defer();

        drive.parents.list({fileId:job['srcFileId']}, function(err, result){
            if (err){
                logger.error(worker.name, err);
                freeWorker(worker);
                return;
            }
            logger.debug(worker.name, result);
            job['srcParents'] = result.items;
            p.resolve();
        });

        return p;
    }

    function makeFolder(){
        var p = new promise.defer();
        var opt = {
            resource:{
                mimeType: 'application/vnd.google-apps.folder',
                title: getPrefix('DST') + '#' + job['oriTitle'],
                parents: job['srcParents'],
            }
        }

        logger.debug(opt);
        drive.files.insert(opt, function(err, result){
            if (err){
                logger.error(worker.name, 'makeFolder', err);
                freeWorker(worker);
                return;
            }
            logger.debug(worker.name, 'makeFolder', result);
            job['dstFileId'] = result['id'];
            p.resolve();

        })
        return p;
    }

    function rename(){
        var p = new promise.defer();
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
            freeWorker(worker);
            return;

        })
        return p;
    }

}

function setPermission(worker, job){
    lockWorker(worker);
    logger.debug(worker.name, 'setPermission()', JSON.stringify(job));
    var copyFunList = [];
    var chain = new promise.defer();
    chain
    .then(getPermission)
    .then(doCopy)
    .then(rename)
    chain.resolve();

    function getPermission(){
        var p = new promise.defer();
        _listPermission(job['srcFileId'], function(err, result){
            if (err){
                logger.error('listPermission error:', err); 
                worker.free = true;
                return;
            }
            logger.debug('listPermission OK', JSON.stringify(result.items, null, 2));
            job['srcPremissions'] = result.items;

            for(var i=0; i < job['srcPremissions'].length; i++){
                copyFunList.push(copyPermission);

            }
          
            p.resolve();
            return;

        });
        return p;
    };
    function copyPermission(opt){
        var p = new promise.defer();
        var idx = opt['idx'];
        var perm = job['srcPremissions'][idx];
        if (perm['id'].match(/i$/)){
            logger.warn('skip Permission ID:', perm['id']);
            p.resolve({idx: idx + 1});
            return p;
        }
        _copyPermission(job['dstFileId'], perm, function(err, result){
            if(err){

                if (err === 'OWNER' || 
                    err === 'NO_EMAIL' ||
                    err === 'NO_USER' ||
                    err === 'SHARE_LINK' ||
                    err === 'SKIP_TYPE' 
                   ){
                       logger.warn('skipped:', err);
                       p.resolve({idx: idx + 1});
                       return;
                   }

                if(err.toString().match(/The owner of a file cannot be removed/) || 
                   err.toString().match(/Permission not found/) || 
                   err.toString().match(/Permission ID mismatch/) ){

                    logger.warn('skipped:', err.toString());
                    p.resolve({idx: idx + 1});
                    return;
                }

                logger.error(err.toString());
                return;
            }

            logger.debug(result);
            p.resolve({idx: idx + 1});
        });
        return p;
    }

    function doCopy(){
        var p = new promise.seq(copyFunList, {idx:0});
        return p;
    };


    function rename(){
        var p = new promise.defer();
        var title = getPrefix('SET_PERMISSION') + '#' + job['srcFileId']+ '#'+job['dstFileId']+'#' + job['oriTitle'];
        _renameFile(job['srcFileId'], title, function(err, file){
            if (err){
                logger.error('rename error:', err); 
                worker.free = true;
                return;
            }
            job['srcTitle'] = file['title']
            job['status'] = getStatus(file['title']);
            logger.debug('SET_PERMISSION successed!', job);

            jobs.push(job);
            logger.warn(jobs);
            freeWorker(worker);
            return;

        })
        return p;
    }


};
function moveFiles(worker, job){
    lockWorker(worker);
    logger.debug(worker.name, 'moveFiles()', JSON.stringify(job));
    var copyFunList = [];
    var chain = new promise.defer();
    chain
    .then(getChildern)
    //.then(doCopy)
    //.then(rename)
    chain.resolve();

    function getChildern(){
        var p = new promise.defer();
        var query = ' not title contains "GDCOPY_SRC#" and not title contains "GDCOPY_DONE"';

        var opt = {
            folderId: job['srcFileId'],
            maxResults: reqCount,
            q: query,
        }
        logger.debug(opt)

        drive.children.list(opt, function(err, result){
            logger.error(err);
            logger.info(JSON.stringify(result, null, 2));

        });
        return p;
    };
    function copyPermission(opt){
        var p = new promise.defer();
        var idx = opt['idx'];
        var perm = job['srcPremissions'][idx];
        if (perm['id'].match(/i$/)){
            logger.warn('skip Permission ID:', perm['id']);
            p.resolve({idx: idx + 1});
            return p;
        }
        _copyPermission(job['dstFileId'], perm, function(err, result){
            if(err){

                if (err === 'OWNER' || 
                    err === 'NO_EMAIL' ||
                    err === 'NO_USER' ||
                    err === 'SHARE_LINK' ||
                    err === 'SKIP_TYPE' 
                   ){
                       logger.warn('skipped:', err);
                       p.resolve({idx: idx + 1});
                       return;
                   }

                if(err.toString().match(/The owner of a file cannot be removed/) || 
                   err.toString().match(/Permission not found/) || 
                   err.toString().match(/Permission ID mismatch/) ){

                    logger.warn('skipped:', err.toString());
                    p.resolve({idx: idx + 1});
                    return;
                }

                logger.error(err.toString());
                return;
            }

            logger.debug(result);
            p.resolve({idx: idx + 1});
        });
        return p;
    }

    function doCopy(){
        var p = new promise.seq(copyFunList, {idx:0});
        return p;
    };


    function rename(){
        var p = new promise.defer();
        var title = getPrefix('SET_PERMISSION') + '#' + job['srcFileId']+ '#'+job['dstFileId']+'#' + job['oriTitle'];
        _renameFile(job['srcFileId'], title, function(err, file){
            if (err){
                logger.error('rename error:', err); 
                worker.free = true;
                return;
            }
            job['srcTitle'] = file['title']
            job['status'] = getStatus(file['title']);
            logger.debug('SET_PERMISSION successed!', job);

            jobs.push(job);
            logger.warn(jobs);
            freeWorker(worker);
            return;

        })
        return p;
    }


};

function changeOwner(worker, job){
    lockWorker(worker);
    logger.debug(worker.name, 'changeOwner()', JSON.stringify(job));

    var ownerId = null;

    var chain = new promise.defer();
    chain
    .then(_changeOwner)
    .then(rename)
    chain.resolve();

    function _changeOwner(){

        var p = new promise.defer();
        _changeOwner(job['dstFileId'], newOwnerPermId, function(err, result){
            if (err){
                logger.error(err);
                process.exit(1);
                return;
            }

            logger.debug(result);
            p.resolve();
        });

        return p;
    }
    function rename(){
        var p = new promise.defer();
        var title = getPrefix('CH_OWNER') + '#' + job['srcFileId']+ '#'+job['dstFileId']+'#' + job['oriTitle'];
        _renameFile(job['srcFileId'], title, function(err, file){
            if (err){
                logger.error('rename error:', err); 
                worker.free = true;
                return;
            }
            job['srcTitle'] = file['title']
            job['status'] = getStatus(file['title']);
            logger.debug('CH_OWNER successed!', job);

            jobs.push(job);
            logger.warn(jobs);
            freeWorker(worker);
            return;

        })
        return p;
    }

}

function removePermission(worker, job){
    lockWorker(worker);
    logger.debug(worker.name, 'removePermission()', JSON.stringify(job));
    var removeFunList = [];
    var chain = new promise.defer();
    chain
    .then(getPermission)
    .then(doRemove)
    .then(rename)
    chain.resolve();

    function getPermission(){
        var p = new promise.defer();
        _listPermission(job['srcFileId'], function(err, result){
            if (err){
                logger.error('listPermission error:', err); 
                worker.free = true;
                return;
            }
            logger.debug('listPermission OK', JSON.stringify(result.items, null, 2));
            job['srcPremissions'] = result.items;

            for(var i=0; i < job['srcPremissions'].length; i++){
                removeFunList.push(rmPermission);

            }
          
            p.resolve();
            return;

        });
        return p;
    };
    function rmPermission(opt){
        var p = new promise.defer();
        var idx = opt['idx'];
        var perm = job['srcPremissions'][idx];
        _deletePermission(job['srcFileId'], perm, function(err, result){
            if(err){
                if (err === 'OWNER' || 
                    err === 'NO_EMAIL' ||
                    err === 'NO_USER' ||
                    err === 'RUNNER_ID' 
                   ){
                       logger.warn('skipped:', err);
                       p.resolve({idx: idx + 1});
                       return;
                   }

                if(err.toString().match(/The owner of a file cannot be removed/) || 
                   err.toString().match(/Permission not found/) || 
                   err.toString().match(/Permission ID mismatch/) ){

                    logger.warn('skipped:', err.toString());
                    p.resolve({idx: idx + 1});
                    return;
                }
                logger.error(err);
                return;
            }

            logger.debug('Permission removed:', perm);
            p.resolve({idx: idx + 1});
        });
        return p;
    }

    function doRemove(){
        var p = new promise.seq(removeFunList, {idx:0});
        return p;
    };


    function rename(){
        var p = new promise.defer();
        var title = getPrefix('RM_PERMISSION') + '#' + job['srcFileId']+ '#'+job['dstFileId']+'#' + job['oriTitle'];
        _renameFile(job['srcFileId'], title, function(err, file){
            if (err){
                logger.error('rename error:', err); 
                worker.free = true;
                return;
            }
            job['srcTitle'] = file['title']
            job['status'] = getStatus(file['title']);
            logger.debug('RM_PERMISSION successed!', job);

            jobs.push(job);
            logger.warn(jobs);
            freeWorker(worker);
            return;

        })
        return p;
    }


};

function markDone(worker, job){
    lockWorker(worker);
    logger.debug(worker.name, 'markDone()', JSON.stringify(job));

    var chain = new promise.defer();
    chain
    .then(renameDstFile)
    .then(renameSrcFile)
    chain.resolve();
    function renameDstFile(){
        var p = new promise.defer();
        var title = job['oriTitle'];
        _renameFile(job['dstFileId'], title, function(err, file){
            if (err){
                logger.error('rename error:', err); 
                worker.free = true;
                return;
            }
            job['dstTitle'] = file['title']
            p.resolve();

            return;

        })
        return p;
    }
    function renameSrcFile(){
        var p = new promise.defer();
        var title = getPrefix('DONE') + '#' + job['srcFileId']+ '#'+job['dstFileId']+'#' + job['oriTitle'];
        _renameFile(job['srcFileId'], title, function(err, file){
            if (err){
                logger.error('rename error:', err); 
                worker.free = true;
                return;
            }
            job['srcTitle'] = file['title']
            job['status'] = getStatus(file['title']);
            logger.info(worker.name, 'DONE successed!', job['dstTitle']);

            logger.warn(jobs);
            p.resolve();
            freeWorker(worker);
            return;

        })
        return p;
    }



}

var handleStatus = {
    'NEW': markFileListed,
    'LISTED': createNewFolder,
    'COPIED': setPermission,
    'SET_PERMISSION': moveFiles,
    /*
    'MOVE_FILE': changeOwner,
    'CH_OWNER': removePermission,
    'RM_PARENT': markDone,
   */

}
