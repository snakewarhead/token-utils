const fs = require('fs/promises')
const path = require('path')
const { DEBUG } = require('./constants')

const suffixKeystore = '.keystore'

const filterABI = (abi, name) => {
  return abi.filter((e) => e.name === name)?.[0]
}

const createWallets = async (ethers, dir, pass, number) => {
  console.log('createWallets ---------- ')

  for (let i = 0; i < number; ++i) {
    const w = ethers.Wallet.createRandom()
    const k = await w.encrypt(pass)
    const n = `${w.address}-${new Date().toISOString()}`
    await fs.writeFile(path.join(dir, n + suffixKeystore), k)

    await fs.appendFile(path.join(dir, '.a'), w.address + '\n')

    console.log(`${w.address} - ${i}`)
  }
}

const loadWalletOne = async (ethers, dir, pass, address) => {
  console.log('loadWalletOne 1 --------- ', dir)

  let wallet
  const files = await fs.readdir(dir)
  for (const fn of files) {
    if (fn.toLocaleLowerCase().indexOf(address.toLocaleLowerCase().slice('0x'.length)) === -1) {
      continue
    }
    const ct = await fs.readFile(path.join(dir, fn), { encoding: 'utf-8' })
    wallet = await ethers.Wallet.fromEncryptedJson(ct, pass)
    wallet = wallet.connect(ethers.provider)
  }
  console.log('loadWalletOne 2 --------- ', wallet?.address)
  return wallet
}

/**
 * load all wallets in keystore dir
 *
 * @param {*} ethers
 * @param {*} dir
 * @param {*} pass
 * @param {*} deal - async (wallet, idx, keystoreFileName) => Promise<Number> - 0: not include, 1: include, 2: break loading loop
 * @returns the promise of the array of wallets
 */
const loadWallets = async (ethers, dir, pass, deal) => {
  console.log('loadWallets --------- ', dir)

  let idx = 0
  const ws = []
  const files = await fs.readdir(dir)
  for (const fn of files) {
    if (!fn.endsWith(suffixKeystore)) {
      continue
    }
    try {
      const ct = await fs.readFile(path.join(dir, fn), { encoding: 'utf-8' })

      let w = await ethers.Wallet.fromEncryptedJson(ct, pass)
      w = w.connect(ethers.provider)

      const res = (await deal(w, idx, fn)) ?? 0
      if (res === 1) {
        ws.push(w)
      } else if (res === 2) {
        break
      }
    } catch (e) {
      console.error(`${fn} - ${e}`)
    }
    ++idx
  }
  console.log('loadWallets --------- count:', ws.length)
  return ws
}

const loadWalletsBalance = async (ethers, dir, pass, over = 0) => {
  console.log('loadWalletsBalance --------- ')

  let total = ethers.BigNumber.from('0')
  const wss = await loadWallets(ethers, dir, pass, async (w, i, f) => {
    const b = await logBalance(ethers, w.address, `${i} - ${f} -`)
    const include = b.gte(ethers.BigNumber.from(over))
    if (include) {
      total = total.add(b)
    }
    return include ? 1 : 0
  })
  console.log(`loadWalletsBalance - count: ${wss.length}, total: ${ethers.utils.formatEther(total)}`)
  return wss
}

const loadWalletsBalanceAll = async (ethers, dir, pass, token) => {
  console.log('loadWalletsBalanceAll --------- ')

  const decimals = (token && (await token.decimals())) ?? 18

  let total = ethers.BigNumber.from('0')
  let totalToken = ethers.BigNumber.from('0')
  const wss = await loadWallets(ethers, dir, pass, async (w, i, f) => {
    const b = await logBalance(ethers, w.address, `${i} - ${f} -`)
    total = total.add(b)

    if (token) {
      const bt = await logBalanceToken(ethers, token, w.address, `${i} token -`, decimals)
      totalToken = totalToken.add(bt)
    }

    return 1
  })
  console.log(
    `loadWalletsBalanceAll - count: ${wss.length}, total: ${ethers.utils.formatEther(total)}, totalToken: ${ethers.utils.formatUnits(totalToken, decimals)}`,
  )
  return wss
}

const loadWalletsBalanceSyn = async (ethers, dir, pass, over = 0) => {
  console.log('loadWalletsBalanceSyn --------- ')

  let total = ethers.BigNumber.from('0')

  const wss = []
  const ws = await loadWallets(ethers, dir, pass, async () => 1)
  for (let i = 0; i < ws.length; ++i) {
    const w = ws[i]
    const b = await logBalance(ethers, w.address, i + ' -')
    if (b.lt(ethers.BigNumber.from(over))) {
      console.log('less over', over)
      continue
    }

    total = total.add(b)
    wss.push(w)
  }
  console.log(`loadWalletsBalanceSyn - count: ${wss.length}, total: ${ethers.utils.formatEther(total)}`)
  return wss
}

const logBalance = async (ethers, address, label = '') => {
  const bal = await ethers.provider.getBalance(address)
  label && console.log(label, address, ethers.utils.formatEther(bal))
  return bal
}

const logBalanceToken = async (ethers, contract, address, label = '', decimals = 18) => {
  const bal = await contract.balanceOf(address)
  label && console.log(label, address, ethers.utils.formatUnits(bal, decimals))
  return bal
}

/**
 * transfer ETH
 *
 * @param {*} ethers
 * @param {*} signer
 * @param {*} to
 * @param {*} value -1: all balance except fee, 0: param error
 * @returns
 */
const transfer = async (ethers, signer, to, value, onFinish, unrestrict, data) => {
  console.log('transfer --------- ')

  if (!unrestrict && signer.address.toLowerCase() === to.toLowerCase()) {
    console.log(`from and to is the same address`)
    return false
  }

  const gasLimit = ethers.BigNumber.from('21944')
  // const gasLimit = ethers.BigNumber.from('21001')
  const feeData = await signer.provider.getFeeData()
  const fee = gasLimit.mul(feeData.maxFeePerGas ?? feeData.gasPrice)
  console.log(
    feeData.maxFeePerGas && `maxFeePerGas: ${ethers.utils.formatUnits(feeData.maxFeePerGas, 'gwei')} gwei`,
    feeData.maxPriorityFeePerGas && `maxPriorityFeePerGas: ${ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, 'gwei')} gwei`,
    `gasPrice: ${ethers.utils.formatUnits(feeData.gasPrice, 'gwei')} gwei`,
    `fee: ${ethers.utils.formatUnits(fee, 'ether')} ether`,
  )

  const bal = await logBalance(ethers, signer.address, 'from -')
  await logBalance(ethers, to, 'to -')

  // all balance except fee
  if (ethers.BigNumber.from('-1').eq(value)) {
    value = bal.sub(fee)
  }

  if (!unrestrict && ethers.BigNumber.from('0').gte(value)) {
    console.log(`lte 0`)
    return false
  }

  const valueAll = value.add(fee)
  if (bal.lt(valueAll)) {
    console.log(`not enough balance ${ethers.utils.formatEther(bal)} - ${ethers.utils.formatEther(value)}`)
    return false
  }

  console.log(`from: ${signer.address}, to: ${to}, value: ${ethers.utils.formatEther(value)}`)

  let req
  if (feeData.maxFeePerGas) {
    req = { to, value, data, gasLimit, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas }
  } else {
    req = { to, value, data, gasLimit, gasPrice: feeData.gasPrice }
  }
  const res = await signer.sendTransaction(req)
  const rec = await res.wait()
  DEBUG && console.log(req, res, rec)
  console.log('transactionHash:', rec.transactionHash)

  await logBalance(ethers, signer.address, 'from -')
  await logBalance(ethers, to, 'to -')

  onFinish && (await onFinish(rec.transactionHash, value))

  return true
}

/**
 * transfer erc20 token
 *
 * @param {*} ethers
 * @param {*} contract
 * @param {*} signer
 * @param {*} to
 * @param {BigNumber} amount -1: all balance except fee, 0: param error
 * @param {*} decimals
 * @returns
 */
const transferToken = async (ethers, contract, signer, to, amount, decimals = 18, onFinish) => {
  console.log('transferToken --------- ')

  if (signer.address.toLowerCase() === to.toLowerCase()) {
    console.log(`from and to is the same address`)
    return false
  }

  const bal = await logBalanceToken(ethers, contract, signer.address, 'from -', decimals)
  await logBalanceToken(ethers, contract, to, 'to -', decimals)

  // all balance except fee
  if (ethers.BigNumber.from('-1').eq(amount)) {
    amount = bal
  }

  if (ethers.BigNumber.from('0').gte(amount)) {
    console.log(`lte 0`)
    return false
  }

  if (bal.lt(amount)) {
    console.log(`not enough balance ${ethers.utils.formatUnits(bal, decimals)} - ${ethers.utils.formatUnits(amount, decimals)}`)
    return false
  }

  console.log(`from: ${signer.address}, to: ${to}, value: ${ethers.utils.formatUnits(amount, decimals)}`)

  contract = contract.connect(signer)
  const res = await contract.transfer(to, amount)
  const rec = await res.wait()
  DEBUG && console.log(res, rec)
  console.log('transactionHash:', rec.transactionHash)

  await logBalanceToken(ethers, contract, signer.address, 'from -', decimals)
  await logBalanceToken(ethers, contract, to, 'to -', decimals)

  onFinish && (await onFinish(rec.transactionHash, amount))

  return true
}

const transferAll = async (ethers, dir, pass, to, miniValue = '0.01') => {
  console.log('transferAll --------- ')

  await logBalance(ethers, to, 'to -')
  const mini = ethers.utils.parseEther(miniValue)

  let total = ethers.BigNumber.from('0')
  await loadWallets(ethers, dir, pass, async (wallet, idx) => {
    if (wallet.address.toLowerCase() === to.toLowerCase()) {
      return 1
    }

    try {
      const bal = await logBalance(ethers, wallet.address, `${idx} -`)
      if (bal.lt(mini)) {
        console.log(`balance less than ${miniValue}`)
        return 0
      }

      // transfer all balance
      const suc = await transfer(ethers, wallet, to, ethers.BigNumber.from('-1'), async (txid, amt) => (total = total.add(amt)))
      return suc ? 1 : 0
    } catch (e) {
      console.error(e)
    }
  })

  await logBalance(ethers, to, 'to -')
  console.log(`transferAll --------- total: ${ethers.utils.formatEther(total)}`)
}

const transferTokenAll = async (ethers, contract, dir, pass, to, miniAmount = '0', excludes = []) => {
  console.log('transferTokenAll --------- ')

  const mini = ethers.BigNumber.from(miniAmount)
  const decimals = await contract.decimals()
  await loadWallets(ethers, dir, pass, async (wallet, idx, fn) => {
    if (wallet.address.toLowerCase() === to.toLowerCase()) {
      return 1
    }

    // excluded?
    if (excludes.includes(wallet.address)) {
      console.log(`${idx} - ${wallet.address} - is in excludes`)
      return 0
    }

    // balance enough?
    const bal = await logBalanceToken(ethers, contract, wallet.address, `${idx} -`, decimals)
    if (bal.lte(mini)) {
      console.log(`${idx} - ${wallet.address} - has not enough balance ${miniAmount}`)
      return 0
    }

    // TODO
    // fee enough?

    // transfer to
  })
}

module.exports = {
  filterABI,

  createWallets,

  loadWalletOne,
  loadWallets,
  loadWalletsBalance,
  loadWalletsBalanceAll,
  loadWalletsBalanceSyn,

  logBalance,
  logBalanceToken,

  transfer,
  transferToken,
  transferAll,
  transferTokenAll,
}
