import { Router } from 'express';
import { getMatchHistory, getUserBetHistory } from '../module/controller/bet.controller';
import { validateUserHeaders } from '../middlewares/auth.middleware';

const router = Router();
router.get('/',(req, res)=>{
    res.send("working")
})
router.get('/single-match-history', getMatchHistory);
router.get('/my-bets', validateUserHeaders, getUserBetHistory);
export default router;
