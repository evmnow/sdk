import type { ContractMetadataDocument } from '../types'

/**
 * Bundled copy of the `interface:erc20` metadata layer from the
 * contract-metadata repository (`schema/interfaces/erc20.json`).
 * Applied as the lowest-priority layer when {@link detectInterfaces}
 * matches the standard, so ABI-only contracts get labeled actions and
 * semantic types without a curated per-address document.
 */
export const erc20Interface: Partial<ContractMetadataDocument> = {
  "groups": {
    "erc20": {
      "label": "ERC-20",
      "order": 99
    }
  },
  "actions": {
    "name": {
      "title": "Token Name",
      "description": "The name of the token.",
      "stateMutability": "view",
      "group": "erc20"
    },
    "symbol": {
      "title": "Token Symbol",
      "description": "The token symbol.",
      "stateMutability": "view",
      "group": "erc20"
    },
    "decimals": {
      "title": "Decimals",
      "description": "Number of decimal places used by the token.",
      "stateMutability": "view",
      "group": "erc20"
    },
    "totalSupply": {
      "title": "Total Supply",
      "description": "Total amount of tokens in existence.",
      "stateMutability": "view",
      "group": "erc20",
      "returns": {
        "_0": {
          "label": "total supply",
          "type": "token-amount"
        }
      }
    },
    "balanceOf": {
      "title": "Balance",
      "description": "Check the token balance of an address.",
      "stateMutability": "view",
      "group": "erc20",
      "params": {
        "_0": {
          "label": "holder",
          "type": "address"
        }
      },
      "returns": {
        "_0": {
          "label": "balance",
          "type": "token-amount"
        }
      }
    },
    "my-balance": {
      "function": "balanceOf",
      "title": "My Balance",
      "description": "Check your own token balance.",
      "stateMutability": "view",
      "group": "erc20",
      "params": {
        "_0": {
          "label": "holder",
          "type": "address",
          "autofill": "connected-address",
          "hidden": true
        }
      },
      "returns": {
        "_0": {
          "label": "balance",
          "type": "token-amount"
        }
      }
    },
    "allowance": {
      "title": "Allowance",
      "description": "Check how many tokens an address has approved another address to spend.",
      "stateMutability": "view",
      "group": "erc20",
      "params": {
        "_0": {
          "label": "owner",
          "type": "address"
        },
        "_1": {
          "label": "spender",
          "type": "address"
        }
      },
      "returns": {
        "_0": {
          "label": "allowance",
          "type": "token-amount"
        }
      }
    },
    "my-allowance": {
      "function": "allowance",
      "title": "My Allowance",
      "description": "Check how much of your own balance you've approved a spender to transfer.",
      "stateMutability": "view",
      "group": "erc20",
      "params": {
        "_0": {
          "label": "owner",
          "type": "address",
          "autofill": "connected-address",
          "hidden": true
        },
        "_1": {
          "label": "spender",
          "type": "address"
        }
      },
      "returns": {
        "_0": {
          "label": "allowance",
          "type": "token-amount"
        }
      }
    },
    "approve": {
      "title": "Approve",
      "description": "Approve a spender to transfer up to the given amount of your tokens.",
      "group": "erc20",
      "intent": "Approve {_0} to spend {_1}",
      "warning": "Approving unlimited amounts is common but carries risk if the spender contract is compromised.",
      "params": {
        "_0": {
          "label": "spender",
          "type": "address"
        },
        "_1": {
          "label": "amount",
          "type": "token-amount"
        }
      },
      "related": [
        "allowance",
        "transferFrom",
        "revoke",
        "approve-max"
      ]
    },
    "approve-max": {
      "function": "approve",
      "title": "Approve Unlimited",
      "description": "Grant unlimited approval to a spender. Convenient but carries risk if the spender contract is ever compromised.",
      "group": "erc20",
      "intent": "Approve {_0} to spend unlimited tokens",
      "warning": "Unlimited approvals let the spender transfer any amount of your tokens at any time.",
      "params": {
        "_0": {
          "label": "spender",
          "type": "address"
        },
        "_1": {
          "label": "amount",
          "autofill": {
            "type": "constant",
            "value": "115792089237316195423570985008687907853269984665640564039457584007913129639935"
          },
          "hidden": true
        }
      },
      "related": [
        "approve",
        "revoke",
        "my-allowance"
      ]
    },
    "revoke": {
      "function": "approve",
      "title": "Revoke Approval",
      "description": "Revoke a previously granted approval by setting its allowance to zero.",
      "group": "erc20",
      "intent": "Revoke approval for {_0}",
      "params": {
        "_0": {
          "label": "spender",
          "type": "address"
        },
        "_1": {
          "label": "amount",
          "autofill": {
            "type": "constant",
            "value": "0"
          },
          "hidden": true
        }
      },
      "related": [
        "approve",
        "my-allowance"
      ]
    },
    "transfer": {
      "title": "Transfer",
      "description": "Transfer tokens to another address.",
      "group": "erc20",
      "intent": "Transfer {_1} to {_0}",
      "params": {
        "_0": {
          "label": "recipient",
          "type": "address"
        },
        "_1": {
          "label": "amount",
          "type": "token-amount"
        }
      },
      "related": [
        "balanceOf",
        "my-balance"
      ]
    },
    "transferFrom": {
      "title": "Transfer From",
      "description": "Transfer tokens from one address to another, using a previously set allowance.",
      "group": "erc20",
      "intent": "Transfer {_2} from {_0} to {_1}",
      "params": {
        "_0": {
          "label": "from",
          "type": "address"
        },
        "_1": {
          "label": "to",
          "type": "address"
        },
        "_2": {
          "label": "amount",
          "type": "token-amount"
        }
      },
      "related": [
        "approve",
        "allowance"
      ]
    }
  },
  "messages": {
    "Permit": {
      "title": "Token Permit (EIP-2612)",
      "description": "Approve a spender to transfer your tokens via an off-chain signature, avoiding a separate approve transaction.",
      "warning": "This grants token spending permission. Verify the spender address and amount carefully. Phishing sites commonly request Permit signatures to drain wallets.",
      "intent": "Permit {spender} to spend {value} of your tokens until {deadline}",
      "fields": {
        "owner": {
          "label": "owner",
          "description": "The token holder granting the approval",
          "type": "address"
        },
        "spender": {
          "label": "spender",
          "description": "The address being approved to spend tokens",
          "type": "address"
        },
        "value": {
          "label": "amount",
          "description": "Maximum amount the spender can transfer"
        },
        "nonce": {
          "label": "nonce",
          "description": "Sequential nonce preventing signature replay"
        },
        "deadline": {
          "label": "deadline",
          "description": "Unix timestamp after which the permit expires",
          "type": "timestamp"
        }
      }
    }
  },
  "events": {
    "Transfer": {
      "description": "Emitted when tokens are transferred.",
      "params": {
        "_0": {
          "label": "from"
        },
        "_1": {
          "label": "to"
        },
        "_2": {
          "label": "amount",
          "type": "token-amount"
        }
      }
    },
    "Approval": {
      "description": "Emitted when an approval is set.",
      "params": {
        "_0": {
          "label": "owner"
        },
        "_1": {
          "label": "spender"
        },
        "_2": {
          "label": "amount",
          "type": "token-amount"
        }
      }
    }
  }
}
