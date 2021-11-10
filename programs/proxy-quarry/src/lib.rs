use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, SetAuthority, TokenAccount};
use quarry_mine::cpi::accounts::{CreateMiner, UserStake};
use quarry_mine::{Miner, Quarry, Rewarder};
use spl_token::instruction::AuthorityType;

declare_id!("5A1Ue8wkuHWAdiQkmurvARuoCvJqCofVC5LXG3Wz1M2Z");

#[program]
pub mod proxy_quarry {
    use super::*;

    const MINER_AUTHORITY_PDA_SEED: &[u8] = b"MinerAuthority";
    const MINER_PDA_SEED: &[u8] = b"Miner";

    // pub fn create_proxy_miner(ctx: Context<CreateProxyMiner>, _bump: u8) -> ProgramResult {
    pub fn create_proxy_miner(ctx: Context<CreateProxyMiner>) -> ProgramResult {
        let quarry_account_info = ctx.accounts.quarry.to_account_info();

        let (miner_authority_pda, _bump_seed) = Pubkey::find_program_address(
            &[
                MINER_AUTHORITY_PDA_SEED,
                quarry_account_info.unsigned_key().as_ref(),
            ], 
            ctx.program_id
        );
        
        msg!("Miner Authority Address: {:?}", miner_authority_pda);
        
        let seeds = &[
            &MINER_AUTHORITY_PDA_SEED[..],
            quarry_account_info.unsigned_key().as_ref(),
            &[_bump_seed]
        ];

        // generate bump seeds for miner account. This could be passed from the frontend, so will be most likely scrapped
        let (pda, _bs) = Pubkey::find_program_address(
            &[
                MINER_PDA_SEED.as_ref(),
                quarry_account_info.unsigned_key().as_ref(),
                miner_authority_pda.as_ref(),
            ],
            ctx.accounts.quarry_mine_program.unsigned_key(),
        );

        msg!("Miner Address, we can pass bump seeds through program: {:?}", pda);
        
        // create miner instruction
        let create_proxy_miner_accounts = CreateMiner {
            authority: ctx.accounts.miner_authority.to_account_info().clone(),
            miner: ctx.accounts.miner.to_account_info().clone(),
            miner_vault: ctx.accounts.miner_vault.to_account_info().clone(),
            payer: ctx.accounts.user.to_account_info().clone(),
            quarry: ctx.accounts.quarry.to_account_info().clone(),
            rewarder: ctx.accounts.rewarder.to_account_info().clone(),
            system_program: ctx.accounts.system_program.to_account_info().clone(),
            token_mint: ctx.accounts.token_mint.to_account_info().clone(),
            token_program: ctx.accounts.token_program.to_account_info().clone(),
        };
        // msg!("CreateMiner Accounts {:?}", create_proxy_miner_accounts);
        let create_miner_context = CpiContext::new(ctx.accounts.quarry_mine_program.clone(), create_proxy_miner_accounts);
        if quarry_mine::cpi::create_miner(create_miner_context.with_signer(&[&seeds[..]]), _bs).is_err() {
            return Err(ErrorCode::CreateMiner.into());
        }
        
        
        Ok(())    
    }
    
    pub fn stake_coin(ctx: Context<StakeCoin>, amt: u64, _bump_seed: u8) -> ProgramResult {
        if amt == 0 {
            return Ok(());
        }
        
        msg!("Getting quarry account info!");
        let quarry_account_info = ctx.accounts.quarry.to_account_info();
        
        msg!("Creating seeds");
        let seeds = &[
            &MINER_AUTHORITY_PDA_SEED[..],
            quarry_account_info.unsigned_key().as_ref(),
            &[_bump_seed]
        ];
        
        msg!("Creating SetAuthority context");
        msg!("Miner Authority raw {:?}", ctx.accounts.miner_authority);
        msg!("Miner Authority address {:?}", ctx.accounts.miner_authority.unsigned_key());
        let set_authority_accounts = SetAuthority {
            account_or_mint: ctx.accounts.temp_token.to_account_info().clone(),
            current_authority: ctx.accounts.user.to_account_info().clone(),
        };
        anchor_spl::token::set_authority(
            CpiContext::new(
                ctx.accounts.token_program.clone(),
                set_authority_accounts,
            ),
            AuthorityType::AccountOwner,
            Some(ctx.accounts.miner_authority.unsigned_key().clone())
        )?;
        msg!("SetAuthority done!");
        
        
        msg!("Creating Staketoken context");
        let stake_tokens_accounts = UserStake {
            authority: ctx.accounts.miner_authority.clone(),
            miner: ctx.accounts.miner.to_account_info().clone(),
            quarry: ctx.accounts.quarry.to_account_info().clone(),
            miner_vault: ctx.accounts.miner_vault.to_account_info().clone(),
            token_account: ctx.accounts.temp_token.to_account_info().clone(),
            token_program: ctx.accounts.token_program.clone(),
            rewarder: ctx.accounts.rewarder.to_account_info().clone(),
        };
        let stake_tokens_context = CpiContext::new(ctx.accounts.quarry_mine_program.clone(), stake_tokens_accounts);
        if quarry_mine::cpi::stake_tokens(stake_tokens_context.with_signer(&[&seeds[..]]), amt).is_err() {
            return Err(ErrorCode::StakeTokens.into());
        }
        
        // logic to store/return token info to user here
        Ok(())
    }
    
}

#[derive(Accounts)]
pub struct CreateProxyMiner<'info> {
    pub user: Signer<'info>,
    #[account(mut)]
    pub miner: AccountInfo<'info>,
    #[account(mut)]
    pub miner_authority: AccountInfo<'info>,
    #[account(mut)]
    pub quarry: Account<'info, Quarry>,
    pub rewarder: Account<'info, Rewarder>,
    pub system_program: Program<'info, anchor_lang::System>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub token_mint: Account<'info, Mint>,
    pub quarry_mine_program: AccountInfo<'info>,
    pub miner_vault: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct StakeCoin<'info> {
    pub user: Signer<'info>,
    #[account(mut)]
    pub miner_authority: AccountInfo<'info>,
    #[account(mut)]
    pub quarry: Account<'info, Quarry>,
    #[account(mut)]
    pub temp_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub miner_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub miner: Account<'info, Miner>,
    pub rewarder: Account<'info, Rewarder>,
    pub token_program: AccountInfo<'info>,
    pub quarry_mine_program: AccountInfo<'info>,
}

#[error]
pub enum ErrorCode {
    #[msg("Issue creating miner")]
    CreateMiner,
    #[msg("Issue creating miner vault")]
    CreateMinerVault,
    #[msg("Issue staking tokens")]
    StakeTokens
}
