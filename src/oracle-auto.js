const { tx, wallet, CONST, rpc, sc, u } = require('@cityofzion/neon-core')
const { Command } = require('commander')
const { Console } = require('console')
// var fs = require ('fs')
// var util = require('util')
var moment = require(`moment`)
var pino = require(`pino`)
const pretty = require('pino-pretty')
var readline = require('readline');

const defaultSystemFee = 0
const defaultNetworkFee = 0
const networkMagic = CONST.MAGIC_NUMBER.TestNet
const ORACLE_CONTRACT_HASH = '6da220a3d216f3375addc9a1de68484daac808f2' // oracle contract hash
const URL = "http://seed1.neo.org:20332"
var nep2key = '6PYVDQz1W1DHRX1F5i9yr8dZh27hJjYCbztR8FAjjYLEL7PM5TdcziC4xa'
var wif = ''
var password = ''

var date = new Date();
//var timestamp = Date.parse(date.getUTCDate()).toString();
//var logPath = Date('Y-m-d.H.i.s', timestamp) + ".log"
// var logPath = moment(date.toISOString()).format('MM-D-YYYY');
// var logfile = fs.createWriteStream(logPath + ".log", {flags: 'a'});

// logger.info = function(args){
//   logfile.write(util.format.apply(null, args) + '\n');
//   process.stdout.write(util.format.apply(null, args) + '\n');
// } 

const createdir = (dest) => 
  pino.destination({dest: dest, append: true, sync: true, colorize: true})
const logdir = moment(date.toISOString()).format('YYYY-MM-D') + ".log";
const streams = [
  {stream: createdir(logdir)},
  {stream: pretty({
    colorize: true,
    sync: true
  })}
]
const logger = pino({ level: 'info' }, pino.multistream(streams));

//const stream = pino.multistream([pino.destination(moment(date.toISOString()).format('YYYY-MM-D') + ".log"), process.stdout]);
// const transport = pino.transport({
//   target: 'pino-pretty'
// }, stream)
// const logger = pino(transport);

// const streams = [
//   {stream: pino.destination(moment(date.toISOString()).format('YYYY-MM-D') + ".log")},
//   {stream: pretty({
//           colorize: true,
//           sync: true,
//           ignore: 'level, pid, hostname'
//       })}
// ]

//const logger = pino({timestamp: pino.stdTimeFunctions.isoTime}, pino.multistream(streams));

if (typeof URL === 'undefined') {
  logger.info('The URL environment variable is not defined.')
  process.exit(1)
}

async function checkNetworkFee (client, transaction) {
  const feePerByteInvokeResponse = await client.invokeFunction(
    CONST.NATIVE_CONTRACT_HASH.PolicyContract,
    'getFeePerByte'
  )

  if (feePerByteInvokeResponse.state !== 'HALT') {
    if (defaultNetworkFee === 0) {
      throw new Error('Unable to retrieve data to calculate network fee.')
    } else {
      logger.info(
        '\u001b[31m  ✗ Unable to get information to calculate network fee.  Using user provided value.\u001b[0m'
      )
      transaction.networkFee = u.BigInteger.fromNumber(defaultNetworkFee)
    }
  }

  const feePerByte = u.BigInteger.fromNumber(
    feePerByteInvokeResponse.stack[0].value
  )
  // Account for witness size
  const transactionByteSize = transaction.serialize().length / 2 + 109;
  // Hardcoded. Running a witness is always the same cost for the basic account.
  const witnessProcessingFee = u.BigInteger.fromNumber(1000390)
  const networkFeeEstimate = feePerByte
    .mul(transactionByteSize)
    .add(witnessProcessingFee)

  if (defaultNetworkFee && networkFeeEstimate.compare(defaultNetworkFee) <= 0) {
    transaction.networkFee = u.BigInteger.fromNumber(defaultNetworkFee);
    logger.info(
      `  i Node indicates ${networkFeeEstimate.toDecimal(
        8
      )} networkFee but using user provided value of ${defaultNetworkFee}`
    );
  } else {
    transaction.networkFee = networkFeeEstimate;
  }
  logger.info(
    `  Network Fee set: ${transaction.networkFee.toDecimal(8)}`
  )
}

async function checkSystemFee (client, transaction, fromAccount) {
  const invokeFunctionResponse = await client.invokeScript(
    u.HexString.fromHex(transaction.script),
    [
      {
        account: fromAccount.scriptHash,
        scopes: tx.WitnessScope.CalledByEntry
      }
    ]
  )
  if (invokeFunctionResponse.state !== 'HALT') {
    throw new Error(`Script errored out: ${invokeFunctionResponse.exception}`)
  }
  const requiredSystemFee = u.BigInteger.fromNumber(
    invokeFunctionResponse.gasconsumed
  );
  if (defaultSystemFee && requiredSystemFee.compare(defaultSystemFee) <= 0) {
    transaction.systemFee = u.BigInteger.fromNumber(defaultSystemFee)
    logger.info(
      `  i Node indicates ${requiredSystemFee} systemFee but using user provided value of ${defaultSystemFee}`
    );
  } else {
    transaction.systemFee = requiredSystemFee;
  }
  logger.info(
    `  SystemFee set: ${transaction.systemFee.toDecimal(8)}`
  );
}

async function getCount (rpcClient) {
  const query = new rpc.Query({
    method: 'invokefunction',
    params: [
      ORACLE_CONTRACT_HASH,
      'getCount',
      [],
      []
    ]
  })
  const response = await rpcClient.execute(query)
  return response.stack[0].value
}

async function getResult (rpcClient) {
  var count = await getCount(rpcClient) - 1;
  const query = new rpc.Query({
    method: 'invokefunction',
    params: [
      ORACLE_CONTRACT_HASH,
      'getResult',
      [
        {
          type: 'Integer',
          value: count
        }
      ],
      []
    ]
  })
  const response = await rpcClient.execute(query)
  return base64hex2str(response.stack[0].value)
}

async function getTime (rpcClient) {
  const query = new rpc.Query({
    method: 'invokefunction',
    params: [
      ORACLE_CONTRACT_HASH,
      'getTime',
      [],
      []
    ]
  })
  const response = await rpcClient.execute(query)
  return response.stack[0].value
}

//交易确认后再等待2个区块，确保回调交易上链
async function testOracle(rpcClient, url, path){
  var start = Date.parse(date.getDate());
  logger.info("Start Time(GMT +8): " + moment(new Date()).format("dddd, MMMM Do YYYY, h:mm:ss a"))
  password = await inputPassword();
  var flag = true;
  while (flag){
    console.log
    if(password.length > 0){
      flag = false;
    } else {
      await sleep(2);
    }
  }
  wif = await openWallet(password);
  const account = new wallet.Account(wif)
  logger.info(`Address: ${account.address} / 0x${account.scriptHash}`)
  logger.info(wif);
  var initialblock =  await rpcClient.getBlockCount();
  var txid = await getData(rpcClient, url, path, password);
  logger.info("txid: " + txid);
  logger.info(`${txid} is sent at block ${initialblock}`);
  var confirm = true;
  var increased = true;
  var i = 0;
  var n = 0;
  var requestConfirmedBlock = 0;
  logger.info("wait for 2 blocks");
  while (confirm){
    logger.info(`${n} s passed...`);
    await sleep(10000)
    requestConfirmedBlock =  await rpcClient.getBlockCount();
    if (requestConfirmedBlock >= initialblock + 2){
      confirm = false;
      logger.info(`New block: ${requestConfirmedBlock}`);
    }
    n += 10;
  }
  var txBlock = await rpcClient.getTransactionHeight(txid);
  logger.info(`${txid} is confirmed at: ${txBlock}`);
  logger.info("Wait 2 blocks for callback tx.");
  while (increased){
    logger.info("Wait callback to be confirmed -> " + i.toString() + " s");
    await sleep (5000);
    var currentBlock =  await rpcClient.getBlockCount();
    increased = !(txBlock != null && requestConfirmedBlock + 2 <= currentBlock);
    i += 5;
  }
  var currentBlock =  await rpcClient.getBlockCount();
  logger.info("New block: " + currentBlock.toString());
  var result = await getTime(rpcClient);
  if(0 < (result - start) < 86400){
    logger.info(`Result: ${result}. Oracle works successfully!`)
  } else {
    logger.info(`Result: ${result}. Current: ${start}. Something wrong...`)
  }
  logger.info(`Result(GMT +8): ${moment(new Date()).format("dddd, MMMM Do YYYY, h:mm:ss a")}`);
}

async function getData (rpcClient, url, path) {
  wif = await openWallet(password);
  const account = new wallet.Account(wif)
  logger.info(`Address: ${account.address} / 0x${account.scriptHash}`)
  const script = sc.createScript({
    scriptHash: ORACLE_CONTRACT_HASH,
    operation: 'doRequest',
    args: [
      sc.ContractParam.string(url),
      sc.ContractParam.string(path)
    ]
  })
  const currentHeight = await rpcClient.getBlockCount()
  logger.info(`Current height: ${currentHeight}`)
  const transaction = new tx.Transaction({
    signers: [
      {
        account: account.scriptHash,
        scopes: tx.WitnessScope.CalledByEntry,
      },
    ],
    validUntilBlock: currentHeight + 1000,
    script: script,
  })
  await checkNetworkFee(rpcClient, transaction)
  await checkSystemFee(rpcClient, transaction, account)
  const signedTransaction = transaction.sign(account, networkMagic)
  const result = await rpcClient.sendRawTransaction(
    u.HexString.fromHex(signedTransaction.serialize(true)).toBase64()
  )
  logger.info(`Transaction hash: ${result}`)
  return result;
}

async function inputPassword(){
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.stdoutMuted = true;
  
  rl.question('Password: ', (pwd) => {
    console.log();
    console.log('Password is confirmed.');
    password = pwd;
    rl.close();
  });

  rl._writeToOutput = function _writeToOutput(stringToWrite) {
    if (rl.stdoutMuted)
      rl.output.write("*");
    else
      rl.output.write(stringToWrite);
  };
  return password;
}

function base64hex2str (value) {
  return u.hexstring2str(u.base642hex(value))
}

function sleep (time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

async function openWallet(){
  wif = wallet.decrypt(nep2key, password);
  return wif;
}

async function generateNep2(privateKey, password){
  nep2 = await wallet.encrypt(privateKey, password)
  console.log(`nep2key: ${nep2}`);
}


(async () => {
  const rpcClient = new rpc.RPCClient(URL)
  const program = new Command()

  program
    .name('oracle-cli')
    .description('CLI for the oracle daily test')
    .version('0.0.1')

  program
    .command('getData')
    .description(
      'Send request for oracle contract to get from the url'
    )
    .argument('url', 'request url')
    .argument('path', 'request jsonpath')
    .action(async (url, path) => {
      await getData(rpcClient, account, url, path)
    })
  
  program
    .command('testOracle')
    .description(
      'request oracle and assert'
    )
    .argument('url', 'request url')
    .argument('path', 'request jsonpath')
    .action(async (url, path) => {
      await testOracle(rpcClient, url, path)
    })

  program
    .command('openWallet')
    .description(
      'open wallet'
    )
    .action(async () => {
      await openWallet()
    })

    program
    .command('inputPassword')
    .description(
      'input password'
    )
    .action(() => {
      inputPassword()
    })

    program
    .command('generateNep2')
    .description(
      'gennerateNep2'
    )
    .argument('privatekey', 'privatekey')
    .argument('password', 'password')
    .action(async (privatekey, password) => {
      await generateNep2(privatekey, password)
    })

  program.parse()
})()
