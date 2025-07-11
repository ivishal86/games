import { Router } from 'express';
import { getMatchHistory, getUserBetHistory } from '../module/controller/bet.controller';
import { validateUserHeaders } from '../middlewares/auth.middleware';

const router = Router();
router.get('/',(req, res)=>{
    res.send("working")
})
router.get('/match-history', getMatchHistory);
router.get('/user-bet-history', validateUserHeaders, getUserBetHistory);
export default router;
