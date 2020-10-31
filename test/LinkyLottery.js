const LinkyLottery = artifacts.require('LinkyLottery')
const MockVRFCoordinator = artifacts.require('MockVRFCoordinator')
const { LinkToken } = require('@chainlink/contracts/truffle/v0.4/LinkToken')
const { MockV2Aggregator } = require('@chainlink/contracts/truffle/v0.6/MockV2Aggregator')
const { BN, constants, ether, expectEvent, expectRevert, time } = require('@openzeppelin/test-helpers')

contract('LinkyLottery', (accounts) => {
  const maintainer = accounts[0]
  const user1 = accounts[1]
  const user2 = accounts[2]
  const user3 = accounts[3]
  const oneWeek = 604800
  const twoWeeks = 1209600
  const num1 = new BN('7777777')
  const num1Hash = web3.utils.soliditySha3(num1)
  const num2 = new BN('8888888')
  const num2Hash = web3.utils.soliditySha3(num2)
  const num3 = new BN('9999999')
  const num3Hash = web3.utils.soliditySha3(num3)
  const winningNumber = new BN('12345678907777777')
  const linkUsd = 1000000000
  const gasWei = 100000000000
  const vrfKeyHash = constants.ZERO_BYTES32
  const vrfFee = ether('1')
  let ll, link, linkUsdFeed, gasPriceFeed, vrfCoordinator

  beforeEach(async () => {
    LinkToken.setProvider(web3.currentProvider)
    MockV2Aggregator.setProvider(web3.currentProvider)
    link = await LinkToken.new({ from: maintainer })
    vrfCoordinator = await MockVRFCoordinator.new(link.address, ether('1'), { from: maintainer })
    gasPriceFeed = await MockV2Aggregator.new(gasWei, { from: maintainer })
    linkUsdFeed = await MockV2Aggregator.new(linkUsd, { from: maintainer })
    ll = await LinkyLottery.new(
      gasPriceFeed.address,
      linkUsdFeed.address,
      link.address,
      vrfCoordinator.address,
      vrfKeyHash,
      vrfFee,
      { from: maintainer },
    )
    await link.transfer(user1, ether('100'), { from: maintainer })
    await link.transfer(user2, ether('100'), { from: maintainer })
    await link.transfer(user3, ether('100'), { from: maintainer })
  })

  describe('onTokenTransfer', () => {
    it('reverts if not called by the LINK token', async () => {
      await expectRevert(
        ll.onTokenTransfer(user1, ether('1'), num1Hash, { from: user1 }),
        'Must use LINK token'
      )
    })

    it('reverts if the lottery is not accepting purchases', async () => {
      await expectRevert(
        link.transferAndCall(ll.address, ether('0.5'), num1Hash, { from: user1 }),
        'Lottery not accepting purchases'
      )
    })

    context('when accepting purchases', () => {
      beforeEach(async () => {
        await time.increase(oneWeek+1)
      })

      it('reverts if not enough LINK is sent', async () => {
        await expectRevert(
          link.transferAndCall(ll.address, ether('0.1'), num1Hash, { from: user1 }),
          'Insufficient LINK to purchase'
        )
      })

      it('reverts if choosing 0', async () => {
        const invalidNumHash = web3.utils.soliditySha3(0)
        const invalidNum = web3.eth.abi.encodeParameter('bytes32', invalidNumHash)
        await expectRevert(
          link.transferAndCall(ll.address, ether('0.5'), invalidNum, { from: user1 }),
          'Invalid number'
        )
      })

      it('gives the caller a lottery ticket', async () => {
        const tx = await link.transferAndCall(ll.address, ether('0.5'), num1Hash, { from: user1 })
        const tokenId = tx.receipt.rawLogs[2].topics[3]
        assert.equal(user1, await ll.ownerOf(tokenId))
      })

      it('adds to the treasury amount', async () => {
        await link.transferAndCall(ll.address, ether('0.5'), num1Hash, { from: user1 })
        assert.isTrue(ether('0.5').eq(await ll.treasury()))
      })

      context('when the treasury is full', () => {
        beforeEach(async () => {
          await link.transferAndCall(ll.address, ether('1'), num1Hash, { from: user1 })
        })

        it('adds to the currentPot', async () => {
          await link.transferAndCall(ll.address, ether('0.5'), num2Hash, { from: user2 })
          assert.isTrue(ether('0.5').eq(await ll.currentPot()))
        })

        it('increases the counter', async () => {
          await link.transferAndCall(ll.address, ether('0.5'), num2Hash, { from: user2 })
          assert.equal(3, await ll.counter())
        })
      })
    })
  })

  describe('initiateRandomnessRequest', () => {
    it('reverts if called too soon', async () => {
      await expectRevert(
        ll.initiateRandomnessRequest(),
        'Requested randomness too soon'
      )
    })

    context('after the randomness frequency', () => {
      beforeEach(async () => {
        await time.increase(twoWeeks+1)
      })

      it('reverts if the gas price is higher than the gas price feed', async () => {
        await expectRevert(
          ll.initiateRandomnessRequest({ gasPrice: gasWei+1 }),
          'Gas price too high'
        )
      })

      it('reverts if not funded', async () => {
        assert.equal(0, await link.balanceOf(ll.address))
        await expectRevert.unspecified(
          ll.initiateRandomnessRequest()
        )
      })

      it('updates the treasury', async () => {
        await link.transferAndCall(ll.address, ether('1'), num1Hash, { from: user1 })
        assert.isTrue(ether('1').eq(await ll.treasury()))
      })

      it('updates the treasury with partial amounts', async () => {
        await link.transferAndCall(ll.address, ether('0.5'), num1Hash, { from: user1 })
        assert.isTrue(ether('0.5').eq(await ll.treasury()))
        await link.transferAndCall(ll.address, ether('0.6'), num2Hash, { from: user2 })
        assert.isTrue(ether('1').eq(await ll.treasury()))
        assert.isTrue(ether('0.1').eq(await ll.currentPot()))
      })

      context('when the treasury is full', () => {
        beforeEach(async () => {
          await link.transferAndCall(ll.address, ether('1'), num1Hash, { from: user1 })
        })

        it('updates lastCalled', async () => {
          await ll.initiateRandomnessRequest()
          const timestamp = await time.latest()
          assert.isTrue(timestamp.eq(await ll.lastCalled()))
        })

        it('stores the requestId', async () =>{
          assert.equal(constants.ZERO_BYTES32, await ll.activeRequest())
          await ll.initiateRandomnessRequest()
          assert.notEqual(constants.ZERO_BYTES32, await ll.activeRequest())
        })
      })
    })
  })

  describe('fulfillRandomness', () => {
    let requestId

    beforeEach(async () => {
      await time.increase(oneWeek+1)
      await link.transferAndCall(ll.address, ether('0.5'), num1Hash, { from: user1 })
      await link.transferAndCall(ll.address, ether('0.5'), num2Hash, { from: user2 })
      await link.transferAndCall(ll.address, ether('0.5'), num3Hash, { from: user3 })
      await time.increase(twoWeeks+1)
      await ll.initiateRandomnessRequest()
      requestId = await ll.activeRequest()
    })

    it('stores the winning number', async () => {
      assert.equal(0, await ll.winningNumber())
      await vrfCoordinator.fulfillRandomnessRequest(ll.address, requestId, winningNumber)
      assert.equal(7777777, await ll.winningNumber())
    })

    it('moves the currentPot to the unclaimedPot', async () => {
      assert.equal(0, await ll.unclaimedPot())
      await vrfCoordinator.fulfillRandomnessRequest(ll.address, requestId, winningNumber)
      assert.isTrue(ether('0.5').eq(await ll.unclaimedPot()))
    })

    it('clears the activeRequest', async () => {
      assert.notEqual(constants.ZERO_BYTES32, await ll.activeRequest())
      await vrfCoordinator.fulfillRandomnessRequest(ll.address, requestId, winningNumber)
      assert.equal(constants.ZERO_BYTES32, await ll.activeRequest())
    })
  })

  describe('claimLottery', () => {
    beforeEach(async () => {
      await time.increase(oneWeek+1)
      await link.transferAndCall(ll.address, ether('0.5'), num1Hash, { from: user1 })
      await link.transferAndCall(ll.address, ether('0.5'), num2Hash, { from: user2 })
      await link.transferAndCall(ll.address, ether('0.5'), num3Hash, { from: user3 })
      await time.increase(oneWeek+1)
    })

    it('reverts if the claimer is not the owner of the tokenId', async () => {
      await ll.initiateRandomnessRequest()
      const requestId = await ll.activeRequest()
      await vrfCoordinator.fulfillRandomnessRequest(ll.address, requestId, winningNumber)
      await expectRevert(
        ll.claimLottery(1, num1, { from: user2 }),
        'Not owner of ticket'
      )
    })

    context('when an active request is in flight', () => {
      beforeEach(async () => {
        await ll.initiateRandomnessRequest()
      })

      it('reverts', async () => {
        await expectRevert(
          ll.claimLottery(1, num1, { from: user1 }),
          'Active request already in flight'
        )
      })
    })

    context('after the oracle has responded', () => {
      beforeEach(async () => {
        await ll.initiateRandomnessRequest()
        const requestId = await ll.activeRequest()
        await vrfCoordinator.fulfillRandomnessRequest(ll.address, requestId, winningNumber)
      })

      it('reverts if the number does not match', async () => {
        await expectRevert(
          ll.claimLottery(1, num2, { from: user1 }),
          'Wrong number from hash'
        )
      })

      it('reverts if the ticket is expired', async () => {
        await time.increase(twoWeeks+1)
        await expectRevert(
          ll.claimLottery(1, num1, { from: user1 }),
          'Ticket expired'
        )
      })

      it('reverts if not the winning number', async () => {
        await expectRevert(
          ll.claimLottery(2, num2, { from: user2 }),
          'Not winning number'
        )
      })

      it('burns the ticket if the winning number', async () => {
        await ll.claimLottery(1, num1, { from: user1 })
        await expectRevert(
          ll.ownerOf(1),
          'ERC721: owner query for nonexistent token'
        )
      })

      it('transfers the unclaimedPot to the winner', async () => {
        assert.isTrue(ether('99.5').eq(await link.balanceOf(user1)))
        await ll.claimLottery(1, num1, { from: user1 })
        assert.isTrue(ether('100').eq(await link.balanceOf(user1)))
      })

      it('clears the unclaimedPot', async () => {
        assert.isTrue(ether('0.5').eq(await ll.unclaimedPot()))
        await ll.claimLottery(1, num1, { from: user1 })
        assert.equal(0, await ll.unclaimedPot())
      })

      it('clears the winning ticket', async () => {
        await ll.claimLottery(1, num1, { from: user1 })
        const ticket = await ll.tickets(1)
        assert.equal(constants.ZERO_BYTES32, ticket.numHash)
        assert.equal(0, ticket.purchaseTime)
      })

      it('clears the winningNumber', async () => {
        await ll.claimLottery(1, num1, { from: user1 })
        assert.equal(0, await ll.winningNumber())
      })
    })
  })
})
