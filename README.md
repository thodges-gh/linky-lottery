# LinkyLottery

LinkyLottery is a lottery contract that accepts payments in LINK, which accumulates in a winning pot that can be claimed if correctly guessing the last 7 digits of a random number provided by the Chainlink VRF. It makes use of the LINK/USD price feed to enforce a ticket price of $5 worth of LINK per ticket and the fast gas feed to ensure that the VRF request can't be abused to interrupt lottery ticket purchases.

Ticket purchases first accumulate in a treasury which is used to pay for the VRF request. After that, payments accumulate in the current pot of the contract. Once the VRF request has been made, the current pot is merged with the unclaimed pot which also accumulates if no one has claimed it between VRF requests, which occur every 2 weeks. After the VRF request, no tickets may be purchased for 7 days.

When selecting a number to purchase a ticket, only the hash of the guessed number needs to be provided. Since the last 7 digits is all that matters for the lottery, you can add numbers to the higher order bytes of a uint256 to mask your guess. For example if you want to guess 7777777 but want to mask the number, you can hash 1234567777777 instead, or any number that can fit into a uint256. If you did select the correct winning number, you only supply the last 7 digits when claiming. Purchasing a lottery ticket rewards the caller with an ERC721 token. The tokenId of the ticket will be provided when claiming and the token will be burned if you won.

This contract is deployed to the [Kovan testnet here](https://kovan.etherscan.io/address/0x4624da54a6379abca4896de793803af554588b92#code). No GUI exists but users can use Etherscan's Write Contract functionality to interact. You will need to interact with the LINK token on Kovan directly in order to use transferAndCall. This can be done by putting the LinkTokenInterface into Remix and setting the At Address to 0xa36085F69e2889c224210F603D836748e7dC0088.

This is unaudited code, and is provided as-is without warranty
