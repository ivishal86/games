import { Router } from "express";
import { fetchFilteredInGameStatements, getEventList, getEvents, getEventWiseReportForAdmin, getTradeProfitLoss, statement, tradeHistory } from "../controllers/tradeController";

const apiRouter = Router();

apiRouter.get("/statement", statement);
apiRouter.get("/trade/history", tradeHistory);
apiRouter.get("/ingame/statements", fetchFilteredInGameStatements);
apiRouter.get("/events", getEventList);
apiRouter.get("/profitloss", getTradeProfitLoss);
apiRouter.get("/admin/events/list", getEvents);
apiRouter.get("/events/profitloss", getEventWiseReportForAdmin);

export default apiRouter;