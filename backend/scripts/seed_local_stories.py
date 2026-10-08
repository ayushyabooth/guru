"""
Demo AI stories for a LOCAL database, so Catch-up and Dive-in have a real feed for persona QA and
screenshots without an ingestion run. No network, no model calls.

    cd backend
    venv/bin/python scripts/seed_local_stories.py --db postgresql://guru@localhost:54329/guru_ui
    venv/bin/python scripts/seed_local_stories.py --db postgresql://guru@localhost:54329/guru_ui --remove

    make seed-local-stories DB=postgresql://guru@localhost:54329/guru_ui     (REMOVE=1 removes)

What the feeds need, and so what this writes through the app's own models, after create_tables():

  articles                 12 AI stories dated over the last 3 days, source "Guru demo", each url under
                           https://demo.guru.local/stories/ (the mark --remove finds them by)
  expert_notes             one per article. Every feed filter reaches an article through its note's
                           expert_industry ("AI") and expert_specializations: without a note, an article
                           shows up in no Catch-up or Dive-in filter
  article_rich_content     what the cards and deep reads show: what's in it, why it matters, between the
                           lines, spotlight quotes (sentences from the story itself), reflection questions,
                           core argument, strongest evidence and counterpoints
  storyboards (and their   the stories that group them: one set for the AI industry, one per AI
  storyboard_articles)     specialization
  storyboard_cache         the rows Catch-up reads storyboards through. It never queries storyboards
                           directly: it looks up a cache row under the all-zero user id and the filter's
                           canonical key, and without a fresh one it clusters the articles itself
                           (embeddings, then model calls). Written for every AI core key, industry:,
                           interest: and specialization: filter, good for 48 hours (re-run to refresh)
  user_saved_articles      two saves for --user (qa-beta@example.com): Dive-in's saved queue is where its
                           deep-reading journey starts
  user_storyboard_prompts  --user's personal prompt on each seeded story, so a specialization filter does
                           not send the backend off to write them with the model

Idempotent: a second run updates the same rows, moving the dates to the new now, and adds none.
--remove deletes every seeded row. Anything hanging off a seeded article or story (saves, highlights,
prompts, not-relevant marks) goes with it, through the database's own cascades.

Local only: --db must be Postgres on localhost or 127.0.0.1 with no query string, and the server must
answer from a loopback address before anything is written. The app's settings module is replaced by a
stub before the app is imported, because app/config.py reads backend/.env at import time, and an audit
hook stops this process from opening any .env or .secrets.local file.
"""
import argparse
import hashlib
import itertools
import logging
import os
import sys
import types
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit


def _refuse_secret_files(event, args):
    """Audit hook: nothing in this process opens an env or secrets file."""
    if event != "open" or not args or not isinstance(args[0], (str, bytes, os.PathLike)):
        return
    name = os.path.basename(os.fsdecode(args[0]))
    if name.startswith(".env") or name == ".secrets.local":
        raise PermissionError(f"seed_local_stories never opens {name}")


sys.addaudithook(_refuse_secret_files)

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_HOSTS = ("localhost", "127.0.0.1")
DEMO = "https://demo.guru.local"
SOURCE = "Guru demo"
BYLINE = "By the Guru demo desk"
NOTE_TEXT = "Via Guru demo"           # ingestion writes "Via <source>" on an article's note
DEFAULT_USER = "qa-beta@example.com"
INDUSTRY = "ai"
BASE_USER = uuid.UUID(int=0)          # base storyboard caches live under the all-zero user id
CACHE_HOURS = 48                      # clustering_service rebuilds a base cache older than 48 hours
BULLETS = ("\U0001F535", "\U0001F7E2", "\U0001F7E1")  # the blue, green and yellow dots of cluster_narrative_service

PRODUCT = "ai_product_applications"
ENGINEERING = "ml_engineering_infrastructure"
MODELS = "foundation_models_llms"
SAFETY = "ai_safety_alignment"
RESEARCH = "ai_research"


def demo_id(path: str) -> uuid.UUID:
    """A stable id for a seeded row, so a second run finds the rows the first one wrote."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"{DEMO}/{path}")


EXPERT_ID = demo_id("expert")

# ── the stories ──────────────────────────────────────────────────────────────
# The first six start from the stories in evals/fixtures.py, the rest are new in the same style. All are
# original short pieces on AI product topics: no real person, no real company, no quotes from anyone.
# Spotlight quotes are sentences from the story's own text (checked at run time).

STORIES = [
    {
        "slug": "eval-gap",
        "title": "The Eval Gap: Why AI Products Ship Without Tests",
        "specs": (PRODUCT, ENGINEERING), "essential": True, "quality": 0.90, "hours_ago": 3,
        "body": [
            "Most teams that ship an AI feature test the plumbing. They check that the endpoint answers, that "
            "latency stays under budget and that nothing crashes. Very few write down what a good answer looks "
            "like before launch, so the first person to find a bad one is usually a customer.",
            "The piece walks through two teams that shipped an AI feature this year. The first measured only "
            "latency and crash rates and learned about a broken answer from a support ticket. The second wrote "
            "twenty behavioral cases before launch, each one a real request and a description of a good reply, "
            "and caught a planning bug in review.",
            "Behavioral cases are not expensive. A spreadsheet of requests, expected behavior and a pass or fail "
            "column is enough to start. What they cost is a decision: someone has to say what good means before "
            "the code exists.",
            "The author's case is simple. An eval is a product spec that runs. Write the behavior down before you "
            "write the code, and every model or prompt change gets checked against it.",
        ],
        "whats_in": "Teams test the plumbing and skip the behavior, so regressions reach users first. The piece "
                    "compares two teams: one tracked only latency and crashes, the other wrote twenty behavioral "
                    "cases before launch and caught a planning bug in review.",
        "why": "If you build AI products, the cheapest quality work happens before launch: deciding what a good "
               "answer looks like and checking every change against it.",
        "between": "The author is arguing against a habit, not a tool. Most teams already have a test framework. "
                   "What they skip is the product decision about what good means.",
        "quotes": ["An eval is a product spec that runs.",
                   "Very few write down what a good answer looks like before launch, so the first person to find a "
                   "bad one is usually a customer."],
        "core": "AI features need behavioral tests written before launch, because infrastructure checks can't "
                "tell a good answer from a bad one.",
        "evidence": ["One team learned about a bad answer from a support ticket",
                     "Twenty behavioral cases caught a planning bug before launch",
                     "A spreadsheet of requests and expected behavior is enough to start"],
        "counter": ["Small teams may not know what users will ask until they launch",
                    "Some behavior only shows up with real traffic"],
        "prompts": ["What would a good answer look like for the AI feature you ship next?",
                    "Which of your current checks would catch a wrong answer, not just a slow one?"],
    },
    {
        "slug": "agents-undo",
        "title": "Agents Need Undo, Not Confirm Dialogs",
        "specs": (PRODUCT, SAFETY), "essential": True, "quality": 0.82, "hours_ago": 6,
        "body": [
            "An agent that books, sends or deletes things on your behalf usually asks first. Are you sure? "
            "Confirm? After the tenth prompt in a day, people stop reading and click yes. The dialog that was "
            "meant to protect them becomes a speed bump they no longer see.",
            "The piece argues for a different default. Let the agent act, show what it did in plain words, and "
            "keep a one-tap undo open for a while. A sent email can sit in an outbox for thirty seconds. A deleted "
            "file can wait in a bin for a week. A calendar change can be rolled back with its old time on record.",
            "Undo does not work for everything. A payment that has cleared or a message someone already read "
            "can't be pulled back. For those, the author keeps a confirmation, and only for those, so the rare "
            "prompt still gets attention.",
            "The test the author proposes is short. If an action can be reversed, design the undo. If it can't, "
            "ask, and make the question specific.",
        ],
        "whats_in": "Confirmation fatigue makes people approve everything, so confirm dialogs stop protecting "
                    "anyone. The piece argues agents should act, show what they did and keep an undo open, and save "
                    "confirmations for the few actions that can't be reversed.",
        "why": "If your product lets an agent take actions, the safety pattern you pick shapes trust: a prompt "
               "people ignore protects no one, while a visible undo keeps them in control.",
        "between": "The piece is about attention as a budget. Every confirmation spends some of it, and an agent "
                   "that asks too often trains people to stop reading.",
        "quotes": ["After the tenth prompt in a day, people stop reading and click yes.",
                   "If an action can be reversed, design the undo."],
        "core": "For reversible actions, agents should act and offer undo instead of asking first, and keep "
                "confirmations for the irreversible few.",
        "evidence": ["Repeated prompts train people to click yes without reading",
                     "Outboxes, bins and change history already make common actions reversible"],
        "counter": ["Some actions can't be undone, like a cleared payment or a read message",
                    "An undo window adds delay and complexity to every action"],
        "prompts": ["Which actions in your product could be reversed instead of confirmed?",
                    "Where would a confirmation still be worth the interruption?"],
    },
    {
        "slug": "voice-handoff",
        "title": "Voice Assistants Are Learning to Hand Off",
        "specs": (PRODUCT,), "essential": False, "quality": 0.71, "hours_ago": 30,
        "body": [
            "For years, a voice assistant that didn't know how to do something said so and stopped. Ask for a "
            "niche task and you got an apology. The newer pattern is a handoff: the assistant recognizes that the "
            "request belongs to another agent, passes it along with the context, and stays in the conversation.",
            "The piece looks at what makes a handoff feel good. The person should not have to repeat themselves, "
            "so the request, the details already given and any preferences travel with it. The person should know "
            "who is answering now. And when the partner agent finishes, control should come back without a "
            "restart.",
            "The hard parts are not the routing. They are trust and accountability. If the partner agent gets "
            "something wrong, the person still blames the assistant they spoke to, so the assistant needs a say "
            "in which partners it trusts and a way to check the result.",
            "The author's conclusion is that the context matters more than the routing. A request passed along "
            "with nothing attached is just a polite failure.",
        ],
        "whats_in": "Assistants now route a request to a partner agent instead of failing it. The piece looks at "
                    "what makes a handoff work: the context travels with the request, the person knows who is "
                    "answering, and control comes back when the task is done.",
        "why": "If you build an assistant or an agent that others plug into, the handoff is the product: lost "
               "context or an unclear owner turns a capability into a failure the user blames on you.",
        "between": "The piece treats accountability as the real design problem. People blame the assistant they "
                   "spoke to, whoever actually did the work.",
        "quotes": ["A request passed along with nothing attached is just a polite failure.",
                   "The person should not have to repeat themselves, so the request, the details already given and "
                   "any preferences travel with it."],
        "core": "Handing a request to a partner agent beats refusing it, but only when the context, the owner and "
                "the way back are designed in.",
        "evidence": ["The person shouldn't repeat details they already gave",
                     "A partner's mistake lands on the assistant the person spoke to"],
        "counter": ["Every partner agent adds a quality risk the assistant can't fully control",
                    "Some requests are better refused than handed to an unknown partner"],
        "prompts": ["What context would a partner need so your user never repeats themselves?",
                    "Who owns the answer when another agent does the work?"],
    },
    {
        "slug": "time-to-first-token",
        "title": "Time to First Token Is the New Page Load",
        "specs": (ENGINEERING,), "essential": False, "quality": 0.77, "hours_ago": 10,
        "body": [
            "People judge a web page by how fast something appears, not by how fast everything loads. The same "
            "rule now applies to AI answers. Users decide whether a product feels quick in the first two seconds, "
            "long before the full answer is written.",
            "The piece separates two numbers that often get blended. Time to first token is how long until the "
            "first words show up. Total time is how long until the answer is complete. A product can have a slow "
            "total and still feel fast if the first line arrives quickly and reads well.",
            "That changes where teams should spend effort. Streaming the answer, sending a short useful first "
            "sentence and showing progress on long tasks all move the first number. A bigger model with a long "
            "silence before it speaks can feel worse than a smaller one that starts right away.",
            "The author's advice is to put time to first token on the same dashboard as error rates, and to watch "
            "it per feature, not as one average.",
        ],
        "whats_in": "Users judge an AI product in the first two seconds, before the answer is done. The piece "
                    "separates time to first token from total time and argues the first number is the one people "
                    "feel.",
        "why": "If your AI feature feels slow, the fix may not be a faster model: streaming, a useful first sentence "
               "and visible progress change how fast it feels.",
        "between": "The piece quietly argues against defaulting to the biggest model. Perceived speed is a product "
                   "choice, and a long silence costs more than a slightly weaker answer.",
        "quotes": ["Users decide whether a product feels quick in the first two seconds, long before the full "
                   "answer is written.",
                   "A bigger model with a long silence before it speaks can feel worse than a smaller one that "
                   "starts right away."],
        "core": "Perceived speed in AI products depends on how fast the first words appear, so teams should "
                "measure and improve time to first token per feature.",
        "evidence": ["People already judge web pages by what appears first, not full load",
                     "Streaming and a short first sentence move the number users feel"],
        "counter": ["A fast first line that turns out wrong costs more trust than a slow correct answer",
                    "Some tasks, like long documents, are judged on the finished result"],
        "prompts": ["What does a user see in the first two seconds of your AI feature?",
                    "Would a smaller model that starts sooner serve your users better?"],
    },
    {
        "slug": "seat-pricing",
        "title": "Per-Seat Pricing Breaks for AI Agents",
        "specs": (PRODUCT,), "essential": False, "quality": 0.68, "hours_ago": 52,
        "body": [
            "Software has been priced by the seat for a long time: one person, one license. That model assumes "
            "the value grows with the number of people using the tool. An agent breaks the assumption. If one "
            "agent does the work of a team, the customer buys fewer seats, and the vendor earns less for "
            "delivering more.",
            "The piece walks through the alternatives teams are trying. Usage pricing charges for what the agent "
            "consumes, like tasks run or minutes of work. Outcome pricing charges for results, like a resolved "
            "support ticket or a booked meeting. Hybrid plans keep a base fee and add usage on top.",
            "Each has a catch. Usage pricing makes bills hard to predict, which finance teams dislike. Outcome "
            "pricing needs both sides to agree on what counts as an outcome, and to trust the count. Hybrid plans "
            "can end up confusing everyone.",
            "The author expects outcome pricing to win where results are easy to count and usage pricing to win "
            "everywhere else. Seats survive for the human tools around the agent.",
        ],
        "whats_in": "Agents do work, not seats, so pricing moves to outcomes and usage. The piece compares usage, "
                    "outcome and hybrid pricing and the catch in each: unpredictable bills, disputed outcomes and "
                    "confusing plans.",
        "why": "If you price an AI product, the unit you charge for shapes behavior on both sides: per seat, you "
               "earn less as the agent gets better at doing the work.",
        "between": "The piece is really about measurement. Whatever you charge for, both sides need to count it "
                   "the same way and trust the count.",
        "quotes": ["If one agent does the work of a team, the customer buys fewer seats, and the vendor earns less "
                   "for delivering more."],
        "core": "Seat pricing stops tracking value once agents do the work, so pricing shifts to usage where "
                "results are fuzzy and to outcomes where they can be counted.",
        "evidence": ["An agent that does a team's work reduces the seats bought",
                     "Resolved tickets and booked meetings are outcomes both sides can count"],
        "counter": ["Buyers like predictable bills, which seats provide",
                    "Outcome definitions invite disputes"],
        "prompts": ["What unit of value would your customers agree to count?",
                    "Does your pricing reward you when the agent gets better?"],
    },
    {
        "slug": "model-on-the-chip",
        "title": "Phones Now Run the Model on the Chip",
        "specs": (MODELS, ENGINEERING), "essential": False, "quality": 0.74, "hours_ago": 20,
        "body": [
            "Phone makers moved small language models onto the chip itself, so a request never leaves the phone. "
            "The pitch is easy to like: answers arrive faster, they work without a signal, and nothing is sent to "
            "the cloud.",
            "The piece sets three makers' launch claims side by side. All three lead with privacy and speed. None "
            "of the makers has published what a day of on-device models costs the battery. None says how much "
            "smaller the local model is than the cloud one it replaces, either.",
            "Both gaps matter for product teams. A feature that drains the battery gets turned off, whatever its "
            "privacy story. And a smaller local model may answer simple requests well while quietly getting harder "
            "ones wrong, which users notice as the assistant being less smart offline.",
            "The author's conclusion is to wait for independent battery tests before believing the launch slides, "
            "and to design features that can fall back to the cloud when the local model is out of its depth.",
        ],
        "whats_in": "Phone makers moved small language models onto the chip itself, and none of them has said what "
                    "it costs the battery.",
        "why": "A model that runs on the phone answers offline and keeps the request private, and it spends the "
               "battery to do it.",
        "between": "The launch pitches lead with privacy and speed, and the battery is the part nobody measured.",
        "quotes": ["None of the makers has published what a day of on-device models costs the battery."],
        "core": "Running the model on the chip is real progress, and its battery cost is still unmeasured.",
        "evidence": ["Three makers' launch claims, side by side", "Not one published battery test"],
        "counter": ["Chips get more efficient with every generation", "Most requests are short"],
        "prompts": ["What would you want measured before you trust a battery claim?",
                    "When should your feature fall back from the phone to the cloud?"],
    },
    {
        "slug": "small-models",
        "title": "Small Models Are Winning the Boring Jobs",
        "specs": (MODELS,), "essential": False, "quality": 0.70, "hours_ago": 27,
        "body": [
            "Not every request needs the biggest model. Sorting an email, pulling a date out of a sentence or "
            "tagging a support ticket are narrow jobs, and small models now do them well. They answer faster and "
            "cost a fraction of what a frontier model costs per request.",
            "The piece describes a pattern many teams have landed on: a router in front of several models. Routine "
            "requests go to a small model. Anything ambiguous, long or high stakes goes to a larger one. Some teams "
            "let the small model say when it is unsure and pass the request up.",
            "The savings are real, but so is the new work. Every route is a decision someone has to test. A "
            "request that looks routine and isn't will get a confident wrong answer from the small model. Teams "
            "that do this well keep a sample of routed requests and check them by hand every week.",
            "The author's point is that model choice has become a product decision per task, not a single "
            "platform choice made once.",
        ],
        "whats_in": "Teams route routine requests to small, cheap models and save the big ones for hard cases. The "
                    "piece covers the router pattern, the savings and the new testing work each route creates.",
        "why": "If your AI costs are climbing, a router can cut them without hurting quality, as long as someone "
               "checks what the small model gets wrong.",
        "between": "The piece suggests the platform question has flipped. Instead of picking one model, teams now "
                   "pick one per task and own the routing.",
        "quotes": ["Every route is a decision someone has to test.",
                   "A request that looks routine and isn't will get a confident wrong answer from the small model."],
        "core": "Routing routine requests to small models saves cost and time, but every route needs its own tests "
                "because misrouted requests fail confidently.",
        "evidence": ["Narrow tasks like tagging and extraction suit small models",
                     "Weekly hand checks of routed requests catch misroutes"],
        "counter": ["A router is one more system to build, watch and debug",
                    "Large models keep getting cheaper, which shrinks the savings"],
        "prompts": ["Which requests in your product are routine enough for a small model?",
                    "How would you find out that a route is sending the wrong requests?"],
    },
    {
        "slug": "agent-budgets",
        "title": "Your Agent Needs a Budget, Not Just a Goal",
        "specs": (SAFETY, PRODUCT), "essential": False, "quality": 0.73, "hours_ago": 14,
        "body": [
            "Give an agent a goal and it will try hard to reach it. Sometimes too hard. Without limits, an agent "
            "that hits an error retries, an agent that can't find an answer searches again, and a task that should "
            "take a minute runs for an hour and spends real money on the way.",
            "The piece describes budgets as a basic part of agent design. A step budget caps how many actions the "
            "agent can take. A time budget caps how long it runs. A spend budget caps tool and model costs. When a "
            "budget runs out, the agent stops and reports what it did and what is left.",
            "The stop is the important part. A good report at the limit tells the person where things stand and "
            "what the agent would do next with more room. A silent failure or a vague apology wastes the work "
            "that was done.",
            "The author argues that budgets also make agents easier to trust. People are more willing to hand "
            "over a task when they know the worst case.",
        ],
        "whats_in": "Agents given a goal and no limits loop, retry and overspend. The piece describes step, time "
                    "and spend budgets, and argues the report an agent gives when it hits a limit matters as much "
                    "as the limit.",
        "why": "If you ship agents, budgets are how you bound the worst case for cost and for the user's patience, "
               "and a clear stop report keeps a halted task useful.",
        "between": "The piece treats a limit as a trust feature, not just a cost control. Knowing the worst case "
                   "is what lets people delegate.",
        "quotes": ["People are more willing to hand over a task when they know the worst case.",
                   "Give an agent a goal and it will try hard to reach it."],
        "core": "Agents need step, time and spend budgets, plus a clear report when they stop, to be safe to "
                "delegate to.",
        "evidence": ["Unbounded retries turn minute-long tasks into hour-long ones",
                     "A report at the limit keeps the work already done"],
        "counter": ["Tight budgets stop agents just before they would have succeeded",
                    "The right budget per task is guesswork at first"],
        "prompts": ["What is the worst case for an agent task in your product today?",
                    "What should your agent say when it runs out of budget?"],
    },
    {
        "slug": "red-teams",
        "title": "Red Teams Are Moving Into the Product Team",
        "specs": (SAFETY,), "essential": True, "quality": 0.75, "hours_ago": 40,
        "body": [
            "Red teaming used to happen at the end. A separate group tried to break a model or a feature right "
            "before launch, wrote a report and handed it over. By then the design was set, and most findings "
            "became a list of known issues.",
            "The piece describes teams that moved the work earlier. Product managers and engineers spend an hour "
            "each sprint trying to misuse their own feature: odd requests, hostile inputs, instructions hidden in "
            "pasted text. The findings go into the same backlog as bugs and get fixed the same way.",
            "The specialists don't disappear. They write the playbooks, train the team and handle the hardest "
            "cases. But the everyday probing happens where the feature is built, by the people who know how it is "
            "supposed to work.",
            "The author's argument fits in one line. A safety problem found during design is just another bug, "
            "and the same problem found after launch is an incident.",
        ],
        "whats_in": "Safety testing is moving from a final review to a habit inside every product sprint. Teams "
                    "spend time each sprint trying to misuse their own features and file what they find as "
                    "ordinary bugs.",
        "why": "If you build AI features, the people who know how a feature should work are best placed to find "
               "how it breaks, and finding it during design costs far less than after launch.",
        "between": "The piece is about ownership. When safety is someone else's review, it arrives too late to "
                   "change the design.",
        "quotes": ["A safety problem found during design is just another bug, and the same problem found after "
                   "launch is an incident."],
        "core": "Routine misuse testing by the product team, backed by specialists, finds safety problems while "
                "they are still cheap to fix.",
        "evidence": ["End-of-cycle findings mostly become lists of known issues",
                     "Sprint-level probing puts findings in the normal bug backlog"],
        "counter": ["Product teams lack the adversarial depth of specialist red teams",
                    "An hour a sprint can turn into a checkbox"],
        "prompts": ["How would someone misuse the feature you are building this sprint?",
                    "Who on your team is responsible for finding how it breaks?"],
    },
    {
        "slug": "retrieval-vs-fine-tuning",
        "title": "Retrieval Beats Fine-Tuning for Fresh Facts",
        "specs": (ENGINEERING, MODELS), "essential": True, "quality": 0.80, "hours_ago": 8,
        "body": [
            "Teams that want a model to know their product, prices or policies have two main options. They can "
            "fine-tune the model on their documents, or they can retrieve the right documents at answer time and "
            "put them in front of the model. For facts that change often, the piece argues retrieval wins.",
            "A fine-tuned model knows what was true on the day it was trained. When a price changes, the model "
            "keeps quoting the old one until someone trains it again. A retrieval system reads the current "
            "document, so the update is as fast as editing a page. It can also show where an answer came from, "
            "which helps people check it.",
            "Fine-tuning still has a place. It is good for style, format and narrow skills that don't change, like "
            "writing in a house voice or filling a fixed form. Many teams use both: fine-tuning for how to answer "
            "and retrieval for what is true right now.",
            "The author's rule of thumb is short. Train the model on how to behave. Look up what is true.",
        ],
        "whats_in": "When facts change weekly, look them up at answer time instead of training them into the model. "
                    "The piece compares fine-tuning and retrieval for product facts and argues retrieval wins on "
                    "freshness and on showing its sources.",
        "why": "If your assistant quotes prices, policies or product details, retrieval keeps answers current as "
               "fast as you edit a page and lets people see the source.",
        "between": "The piece separates two jobs that often get lumped together: teaching a model how to answer and "
                   "telling it what is true.",
        "quotes": ["Train the model on how to behave. Look up what is true.",
                   "A fine-tuned model knows what was true on the day it was trained."],
        "core": "For facts that change, retrieval at answer time beats fine-tuning, while fine-tuning stays useful "
                "for style and stable skills.",
        "evidence": ["A fine-tuned model repeats outdated facts until it is trained again",
                     "Retrieved answers can point to the document they came from"],
        "counter": ["Retrieval is only as good as its search, and bad search gives confident wrong answers",
                    "Long retrieved context adds cost and time to every request"],
        "prompts": ["Which facts in your product change faster than you could retrain a model?",
                    "How would a user check where an answer came from?"],
    },
    {
        "slug": "long-context-memory",
        "title": "Long Context Is Not Memory",
        "specs": (MODELS, RESEARCH), "essential": False, "quality": 0.72, "hours_ago": 46,
        "body": [
            "Context windows have grown from a few pages to whole books. It is tempting to treat that as memory. "
            "Paste in every past conversation and the model will remember the user, the thinking goes. The piece "
            "argues that this confuses reading with remembering.",
            "A context window is what the model can read right now. When the conversation ends, it is gone. Real "
            "memory means deciding what to keep, storing it, and bringing back the right piece later. Stuffing "
            "everything into the window skips the deciding, and the model has to find the one useful detail in a "
            "pile of old text every time.",
            "That costs money and accuracy. Long inputs are slower and more expensive, and models still miss "
            "details buried in the middle of very long inputs. Products that feel like they remember usually store "
            "a few short facts about the user and bring them back on purpose.",
            "The author's conclusion is that memory is a product feature with choices to make: what to keep, for "
            "how long, and how the user can see and delete it.",
        ],
        "whats_in": "A bigger context window lets a model read more at once, but it still forgets everything when "
                    "the conversation ends. The piece argues real memory means choosing what to keep and bringing "
                    "it back on purpose.",
        "why": "If your product promises to remember users, a large context window alone is a costly stand-in: "
               "memory needs decisions about what to store, for how long and how users control it.",
        "between": "The piece warns against letting a model spec stand in for a product decision. A larger window "
                   "is capacity, not a memory feature.",
        "quotes": ["A context window is what the model can read right now.",
                   "Products that feel like they remember usually store a few short facts about the user and bring "
                   "them back on purpose."],
        "core": "Long context windows are not memory: products need deliberate storage and recall of a few useful "
                "facts, with the user in control.",
        "evidence": ["Long inputs are slower and more expensive to process",
                     "Details buried in very long inputs still get missed"],
        "counter": ["Larger windows keep getting cheaper and more reliable",
                    "Deciding what to store risks dropping something the user cared about"],
        "prompts": ["What should your product remember about a user, and for how long?",
                    "How would a user see and delete what it remembers?"],
    },
    {
        "slug": "benchmarks-vs-users",
        "title": "Benchmarks Stopped Predicting What Users Feel",
        "specs": (RESEARCH, PRODUCT), "essential": False, "quality": 0.69, "hours_ago": 60,
        "body": [
            "Every few weeks a new model tops a leaderboard. Users of the products built on those models often "
            "report little change. The piece asks why public benchmarks and user experience have drifted apart.",
            "Part of the answer is saturation. When most models score near the top of a test, small gains stop "
            "meaning much. Part is contamination: test questions leak into training data, so a high score can mean "
            "memory rather than skill. And part is fit. Benchmarks reward what is easy to score, like multiple "
            "choice or short exact answers, while users care about tone, judgment and whether the answer helped.",
            "The teams that pick models well run their own tests. They collect real requests from their product, "
            "define what a good answer looks like, and compare models on those. Their results often disagree with "
            "the leaderboard.",
            "The author's advice is to read leaderboards as a shortlist, not a verdict. The test that matters is "
            "the one built from your own users' requests.",
        ],
        "whats_in": "Models keep topping leaderboards while users report little difference, because benchmarks "
                    "test what is easy to score. The piece covers saturation, contamination and fit, and argues for "
                    "testing models on your own users' requests.",
        "why": "If you choose models for a product, a leaderboard rank is a starting shortlist: the comparison that "
               "predicts your users' experience is one built from their requests.",
        "between": "The piece connects to the eval gap: teams that already write behavioral cases for their product "
                   "get a model comparison almost for free.",
        "quotes": ["Benchmarks reward what is easy to score, like multiple choice or short exact answers, while "
                   "users care about tone, judgment and whether the answer helped.",
                   "The test that matters is the one built from your own users' requests."],
        "core": "Public benchmarks no longer predict product quality well, so teams should compare models on tests "
                "built from their own users' requests.",
        "evidence": ["Near-top scores leave little room to show real gains",
                     "Leaked test questions can turn a skill test into a memory test"],
        "counter": ["Private tests are small and can be noisy",
                    "Shared benchmarks still let the field compare progress over time"],
        "prompts": ["Which model would win on a test built from your users' real requests?",
                    "What does your product need that no public benchmark measures?"],
    },
]

# The stories that group them, as the clustering would: the first slug is the headline. A multi-article story
# carries a two-sentence summary, the context line of its "Also in this story" narrative, and the personal
# prompt --user gets on it. A one-article story uses its article's own summary, as the app does.
GROUPS = [
    {"key": "evals", "slugs": ["eval-gap", "benchmarks-vs-users", "red-teams"],
     "summary": "Teams keep testing the plumbing of AI features and skipping the behavior. These pieces argue for "
                "checking what the model actually does, with your own cases, before users find out.",
     "context": "These pieces share one worry: AI features ship with checks that can't tell a good answer from a "
                "bad one. Each argues for testing behavior directly, earlier, and with cases built from real use.",
     "prompt": "Which AI feature you work on would fail a behavior test today?"},
    {"key": "agent-limits", "slugs": ["agents-undo", "agent-budgets"],
     "summary": "Agents that act on a user's behalf need limits people can see. Both pieces argue for designing the "
                "worst case up front: undo for what can be reversed, budgets and a clear stop for the rest.",
     "context": "Both pieces are about delegation. An agent people can trust shows what it did, can be undone where "
                "possible, and stops at a clear limit with a useful report instead of retrying forever.",
     "prompt": "What is the worst thing an agent in your product could do before anyone notices?"},
    {"key": "smaller-models", "slugs": ["model-on-the-chip", "small-models"],
     "summary": "Smaller models are moving closer to the user, onto phones and in front of the big models as "
                "routers. The savings in speed and cost are real, and so are the new things to measure.",
     "context": "Smaller models are taking on more work, both on the phone and behind routers in the cloud. These "
                "pieces weigh the speed and cost wins against what nobody has measured yet.",
     "prompt": "Which of your requests could a smaller, closer model handle?"},
    {"key": "first-token", "slugs": ["time-to-first-token"],
     "prompt": "What does your user see in the first two seconds?"},
    {"key": "agent-pricing", "slugs": ["seat-pricing"],
     "prompt": "What would you charge for if an agent did the work?"},
    {"key": "handoffs", "slugs": ["voice-handoff"],
     "prompt": "What context gets lost when your product hands a request to someone else?"},
    {"key": "knowing-and-remembering", "slugs": ["retrieval-vs-fine-tuning", "long-context-memory"],
     "summary": "What a model knows and what it can look up are different things. These pieces argue for retrieval "
                "and deliberate memory over training facts in or stuffing the context window.",
     "context": "Both pieces separate what a model can read from what a product should know. Fresh facts belong in "
                "retrieval, and memory needs deliberate choices about what to keep and for how long.",
     "prompt": "What should your product look up, and what should it remember?"},
]

SAVES = ("eval-gap", "long-context-memory")  # --user's saved-for-later queue in Dive-in


# ── local only ───────────────────────────────────────────────────────────────

def local_db_url(raw: str) -> str:
    """--db, or exit: Postgres on localhost or 127.0.0.1, one host, a database name and no query string
    (libpq's host=, hostaddr= and service= parameters could otherwise point it somewhere else)."""
    try:
        parts = urlsplit(raw or "")
        host = parts.hostname
        _ = parts.port  # a malformed port raises here
    except ValueError:
        sys.exit("--db is not a database URL.")
    if parts.scheme not in ("postgresql", "postgresql+psycopg2"):
        sys.exit(f"--db must be a postgresql:// URL, not {parts.scheme or 'a bare string'}.")
    if "," in parts.netloc.rpartition("@")[2] or host not in LOCAL_HOSTS:
        sys.exit(f"--db must point at localhost or 127.0.0.1, not {host or 'no host'}. Local scratch databases only.")
    if parts.query or parts.fragment:
        sys.exit("--db takes no query string: host=, hostaddr= or service= could send it somewhere else.")
    if not parts.path.strip("/"):
        sys.exit("--db names no database.")
    return raw


def engine_url(raw: str) -> str:
    """The URL the app's engine gets: --db plus a name in pg_stat_activity and bounded waits. create_tables()
    runs ALTER TABLE ADD COLUMN on tables a running backend may be reading, so no lock wait runs past 5s."""
    from sqlalchemy.engine import make_url
    url = make_url(raw).update_query_dict({
        "application_name": "seed_local_stories",
        "options": "-c lock_timeout=5000 -c statement_timeout=60000",
    })
    return url.render_as_string(hide_password=False)


def load_app(url: str):
    """The app's database module, imported with its settings stubbed. app/config.py reads backend/.env when it is
    imported; this script must not, so app.config is replaced by the two settings app/db/database.py reads."""
    for var in ("PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE"):
        os.environ.pop(var, None)  # libpq defaults that could redirect a connection
    stub = types.ModuleType("app.config")
    stub.settings = types.SimpleNamespace(DATABASE_URL=url, DEBUG=False)
    sys.modules["app.config"] = stub
    sys.path.insert(0, BACKEND)
    import app
    app.config = stub
    from app.db import database
    return database


def check_local(db) -> str:
    """Stop before any write unless the server answers from a loopback address. Returns the database name."""
    from sqlalchemy import text
    addr, name = db.execute(text("select host(inet_server_addr()), current_database()")).one()
    if addr not in ("127.0.0.1", "::1"):
        sys.exit(f"The database server answered from {addr or 'a socket'}, not a loopback address. Nothing written.")
    return name


# ── shared ───────────────────────────────────────────────────────────────────

class Tally:
    """What happened to each table, in the order tables were first touched."""

    def __init__(self):
        self.rows = {}

    def add(self, table: str, what: str, n: int = 1):
        if n:
            counts = self.rows.setdefault(table, {})
            counts[what] = counts.get(what, 0) + n

    def show(self):
        width = max((len(t) for t in self.rows), default=0)
        for table, counts in self.rows.items():
            print(f"  {table:{width}}  " + ", ".join(f"{n} {what}" for what, n in counts.items()))


def upsert(db, tally: Tally, model, lookup: dict, values: dict, new_id=None):
    """The row matching lookup, created or brought up to date with values."""
    row = db.query(model).filter_by(**lookup).one_or_none()
    if row is None:
        row = model(**lookup, **values)
        if new_id is not None:
            row.id = new_id
        db.add(row)
        tally.add(model.__tablename__, "inserted")
        return row
    changed = False
    for key, value in values.items():
        if getattr(row, key) != value:
            setattr(row, key, value)
            changed = True
    tally.add(model.__tablename__, "updated" if changed else "unchanged")
    return row


def prune_cache_refs(db, tally: Tally, drop_ids, keep=()):
    """Take storyboards that are going away out of every cache row except keep; delete a row left empty."""
    from app.models.cache import StoryboardCache
    drop = {str(i) for i in drop_ids}
    if not drop:
        return
    keep = set(keep)
    for row in db.query(StoryboardCache).all():
        if row.id in keep:
            continue
        ids = list(row.storyboard_ids or [])
        left = [i for i in ids if str(i) not in drop]
        if len(left) == len(ids):
            continue
        if left:
            row.storyboard_ids = left
            tally.add("storyboard_cache", "trimmed")
        else:
            db.delete(row)
            tally.add("storyboard_cache", "deleted")


def seeded_article_ids(db):
    from app.models.article import Article
    return [r[0] for r in db.query(Article.id).filter(Article.url.like(f"{DEMO}/%")).all()]


def storyboards_on(db, article_ids):
    """Storyboards whose headline is one of these articles: the seeded ones, and any the backend built from them."""
    from app.models.storyboard import Storyboard
    if not article_ids:
        return []
    return [r[0] for r in db.query(Storyboard.id).filter(Storyboard.headline_article_id.in_(article_ids)).all()]


def delete_storyboards(db, tally: Tally, ids):
    """Bulk delete, so the database cascades to storyboard_articles, prompts and not-relevant marks."""
    from app.models.storyboard import Storyboard
    if ids:
        n = db.query(Storyboard).filter(Storyboard.id.in_(ids)).delete(synchronize_session=False)
        tally.add("storyboards", "deleted", n)


def delete_articles(db, tally: Tally, ids):
    """Bulk delete, so the database cascades to notes, rich content, saves, highlights and Q&A. ingestion_logs
    is the one table whose reference has no cascade: it is cleared first."""
    from app.models.article import Article
    from app.models.ingestion import IngestionLog
    if not ids:
        return
    n = db.query(IngestionLog).filter(IngestionLog.article_id.in_(ids)).update(
        {IngestionLog.article_id: None}, synchronize_session=False)
    tally.add("ingestion_logs", "unlinked", n)
    n = db.query(Article).filter(Article.id.in_(ids)).delete(synchronize_session=False)
    tally.add("articles", "deleted", n)


# ── seed ─────────────────────────────────────────────────────────────────────

def story_text(story) -> tuple:
    """The story's text, and its raw_text: the same with the byline on top."""
    body = "\n\n".join(story["body"])
    return body, f"{BYLINE}\n\n{body}"


def minutes(story) -> int:
    """Reading time the way cluster_narrative_service counts it: 225 words a minute."""
    return max(1, round(len(story_text(story)[1].split()) / 225))


def truncated(title: str, limit: int = 50) -> str:
    """cluster_narrative_service._truncate_title."""
    return title if len(title) <= limit else title[:limit].rsplit(" ", 1)[0] + "..."


def ranking_score(stories) -> float:
    """clustering_service._compute_storyboard_ranking_score on the seeded values. The headline comes first,
    freshness loses 1/14 a whole day old, and the tier counts 0.5 because seeded rows have no ingestion tier."""
    quality = [s["quality"] for s in stories]
    freshness = max(max(0.0, 1.0 - (s["hours_ago"] // 24) / 14) for s in stories)
    return round(0.35 * sum(quality) / len(quality) + 0.25 * stories[0]["quality"] + 0.20 * 0.5
                 + 0.10 * freshness + 0.10 * sum(s["essential"] for s in stories) / len(stories), 4)


def seed(database, email: str):
    from sqlalchemy import func
    from app.models.article import Article, ExpertNote
    from app.models.article_rich_content import ArticleRichContent
    from app.models.cache import StoryboardCache
    from app.models.interaction import UserSavedArticle
    from app.models.storyboard import Storyboard, StoryboardArticle, UserStoryboardPrompt
    from app.models.user import User
    from app.services.industries_config import IndustriesConfig

    config = IndustriesConfig.get_instance()
    industry = config.get_display_name(INDUSTRY, "industry")
    spec_name = {s["id"]: s["name"] for s in (config.get_specializations(INDUSTRY) or [])}
    if not industry or not {PRODUCT, ENGINEERING, MODELS, SAFETY, RESEARCH} <= set(spec_name):
        sys.exit("config/industries-specializations.json no longer has the AI industry and its five "
                 "specializations this script tags stories with.")

    now = datetime.now(timezone.utc)
    stories = {s["slug"]: s for s in STORIES}
    tally = Tally()
    db = database.SessionLocal()
    try:
        server_db = check_local(db)

        # Articles, their notes and their rich content.
        art_id = {}
        for s in STORIES:
            text_, raw = story_text(s)
            missing = [q for q in s["quotes"] if q not in text_]
            if missing:
                sys.exit(f"{s['slug']}: a spotlight quote is not in the story's text: {missing[0]!r}")
            created = now - timedelta(hours=s["hours_ago"])
            names = [spec_name[x] for x in s["specs"]]
            url = f"{DEMO}/stories/{s['slug']}"
            article = upsert(db, tally, Article, {"url": url}, {
                "title": s["title"], "source": SOURCE, "publish_date": created - timedelta(hours=2),
                "raw_text": raw, "word_count": len(raw.split()), "is_paywalled": False,
                "article_image_url": None, "scrape_attempted": True, "image_source": None, "inline_images": [],
                "ingestion_tier": None, "quality_score": s["quality"], "luminary_id": None, "discovery_query": None,
                "content_hash": hashlib.sha256(raw.encode()).hexdigest(),
                "industries": [industry], "specializations": names, "created_at": created,
            }, new_id=demo_id(f"stories/{s['slug']}"))
            db.flush()
            art_id[s["slug"]] = article.id
            upsert(db, tally, ExpertNote, {"expert_id": EXPERT_ID, "article_id": article.id}, {
                "notes_text": NOTE_TEXT, "priority": "Essential" if s["essential"] else "Normal",
                "auto_generated": False, "expert_industry": industry, "expert_specializations": names,
            }, new_id=demo_id(f"stories/{s['slug']}/note"))
            upsert(db, tally, ArticleRichContent, {"article_id": article.id}, {
                "summary_whats_in": s["whats_in"], "summary_why_matters": s["why"],
                "summary_between_lines": s["between"], "spotlight_quotes": s["quotes"],
                "core_argument": s["core"], "strongest_evidence": s["evidence"], "counterpoints": s["counter"],
                "socratic_prompts": s["prompts"], "context_summary": text_,
                "industry_context": industry, "specialization_context": names[0],
                "model_used": "none: seed_local_stories",
            }, new_id=demo_id(f"stories/{s['slug']}/rich"))

        # Seeded articles no longer in STORIES (an older version of this list) go, with their storyboards.
        stale_articles = [i for i in seeded_article_ids(db) if i not in set(art_id.values())]
        stale_boards = storyboards_on(db, stale_articles)

        # Storyboards: one set for the AI industry, one per AI specialization.
        subsets = {"ai": ("core", "core:ai:general", list(stories))}
        for spec in (PRODUCT, ENGINEERING, MODELS, SAFETY, RESEARCH):
            key = f"specialization:{spec_name[spec]}"
            subsets[spec] = (key, key, [x for x in stories if spec in stories[x]["specs"]])
        boards = {}  # subset -> storyboard ids, in GROUPS order
        prompt_for = {}  # storyboard id -> --user's personal prompt
        for subset, (filter_context, base_key, slugs) in subsets.items():
            boards[subset] = []
            for group in GROUPS:
                members = [x for x in group["slugs"] if x in slugs]
                if not members:
                    continue
                arts = [stories[x] for x in members]
                head = arts[0]
                if len(arts) > 1:
                    # cluster_narrative_service's shape: a context line, then "Also in this story:" and a
                    # colored dot, title and reading time for each article after the headline.
                    summary = group["summary"]
                    narrative = "\n".join([group["context"], "", "Also in this story:"] + [
                        f"{BULLETS[i % len(BULLETS)]} {truncated(a['title'])} ({minutes(a)} min)"
                        for i, a in enumerate(arts[1:])])
                else:
                    summary, narrative = head["whats_in"], None  # the app's one-article story, no model
                sb_id = demo_id(f"storyboards/{subset}/{group['key']}")
                upsert(db, tally, Storyboard, {"id": sb_id}, {
                    "industry": industry,
                    "specializations": sorted({spec_name[x] for a in arts for x in a["specs"]}),
                    "filter_context": filter_context, "headline_article_id": art_id[head["slug"]],
                    "summary": summary, "personal_prompt": None, "cluster_narrative": narrative,
                    "ranking_score": ranking_score(arts), "base_cache_key": base_key, "created_at": now,
                })
                db.flush()
                db.query(StoryboardArticle).filter(StoryboardArticle.storyboard_id == sb_id).delete(
                    synchronize_session=False)
                for rank, x in enumerate(members, start=1):
                    db.add(StoryboardArticle(storyboard_id=sb_id, article_id=art_id[x], rank=rank))
                tally.add("storyboard_articles", "written", len(members))
                boards[subset].append(sb_id)
                prompt_for[sb_id] = group["prompt"]
        current = set(prompt_for)
        stale_boards += [i for i in storyboards_on(db, list(art_id.values())) if i not in current]
        db.flush()

        # The cache rows Catch-up reads them through. Core keys resolve to "core:ai:<the user's specialization
        # ids, sorted>" (clustering_service.resolve_base_cache_key), so every combination is written: any AI
        # profile, whatever it follows, finds its feed. industry: and interest: come with the id and the name,
        # and specializations with the display name a profile stores and the id an agent may pass.
        spec_ids = sorted(spec_name)
        keys = {"core:ai:general": "ai"}
        for r in range(1, len(spec_ids) + 1):
            for combo in itertools.combinations(spec_ids, r):
                keys["core:ai:" + ",".join(combo)] = "ai"
        for kind in ("industry", "interest"):
            for value in (INDUSTRY, industry):
                keys[f"{kind}:{value}"] = "ai"
        for spec in subsets:
            if spec != "ai":
                keys[f"specialization:{spec_name[spec]}"] = spec
                keys[f"specialization:{spec}"] = spec
        cache_ids = {key: demo_id(f"cache/{key}") for key in keys}
        n = db.query(StoryboardCache).filter(
            StoryboardCache.user_id == BASE_USER, StoryboardCache.filter_context.in_(list(keys)),
            ~StoryboardCache.id.in_(list(cache_ids.values())),
        ).delete(synchronize_session=False)
        tally.add("storyboard_cache", "replaced (other base rows on these keys)", n)
        for key, subset in keys.items():
            upsert(db, tally, StoryboardCache, {"id": cache_ids[key]}, {
                "user_id": BASE_USER, "filter_context": key, "cache_date": date.today().strftime("%Y-%m-%d"),
                "storyboard_ids": [str(i) for i in boards[subset]],
                "created_at": now, "expires_at": now + timedelta(hours=CACHE_HOURS),
            })
        prune_cache_refs(db, tally, list(stale_boards) + list(current), keep=cache_ids.values())
        delete_storyboards(db, tally, stale_boards)
        delete_articles(db, tally, stale_articles)

        # --user: two saves, and a personal prompt on every seeded story.
        user = db.query(User).filter(func.lower(User.email) == email.lower()).one_or_none() if email else None
        if user:
            for slug in SAVES:
                saved = min(now - timedelta(hours=stories[slug]["hours_ago"] - 2), now)
                upsert(db, tally, UserSavedArticle, {"user_id": user.id, "article_id": art_id[slug]},
                       {"saved_at": saved}, new_id=demo_id(f"saves/{user.id}/{slug}"))
            for sb_id, prompt in prompt_for.items():
                upsert(db, tally, UserStoryboardPrompt, {"user_id": user.id, "storyboard_id": sb_id},
                       {"personal_prompt": prompt}, new_id=demo_id(f"prompts/{user.id}/{sb_id}"))

        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()

    print(f"Seeded {len(STORIES)} demo AI stories into {server_db} ({DEMO}/stories/...)")
    tally.show()
    if email and not user:
        print(f"  {email} is not on this database: no saves or personal prompts written.")
    elif user:
        print(f"  saves and personal prompts are {email}'s")
    until = (now + timedelta(hours=CACHE_HOURS)).astimezone().strftime("%a %b %d %H:%M %Z")
    print("Catch-up stories per filter: " + ", ".join(
        [f"core/industry:AI {len(boards['ai'])}"]
        + [f"specialization:{spec_name[s]} {len(boards[s])}" for s in subsets if s != "ai"]))
    print(f"The cache rows serve until {until} at the latest. Re-run to refresh the dates and the cache. "
          f"Remove: the same command with --remove.")


# ── remove ───────────────────────────────────────────────────────────────────

def remove(database):
    from sqlalchemy import func, or_
    from app.models.article import Article, ArticleAnnotation, ExpertNote
    from app.models.article_rich_content import ArticleRichContent
    from app.models.interaction import UserAnnotation, UserInteraction, UserNotRelevant, UserSavedArticle
    from app.models.qa_models import QAExchange
    from app.models.storyboard import StoryboardArticle, UserStoryboardPrompt

    tally = Tally()
    db = database.SessionLocal()
    try:
        server_db = check_local(db)
        articles = seeded_article_ids(db)
        boards = storyboards_on(db, articles)

        def count(model, *conditions):
            return db.query(func.count()).select_from(model).filter(*conditions).scalar() or 0

        # What goes with them through the cascades, counted first so the report can say so.
        if boards:
            tally.add("storyboard_articles", "deleted", count(StoryboardArticle, or_(
                StoryboardArticle.storyboard_id.in_(boards), StoryboardArticle.article_id.in_(articles))))
            tally.add("user_storyboard_prompts", "deleted",
                      count(UserStoryboardPrompt, UserStoryboardPrompt.storyboard_id.in_(boards)))
            tally.add("user_not_relevant", "deleted", count(UserNotRelevant, UserNotRelevant.storyboard_id.in_(boards)))
        elif articles:
            tally.add("storyboard_articles", "deleted",
                      count(StoryboardArticle, StoryboardArticle.article_id.in_(articles)))
        if articles:
            for model, what in ((ArticleRichContent, "deleted"), (ExpertNote, "deleted"),
                                (UserSavedArticle, "deleted"), (UserAnnotation, "deleted"),
                                (ArticleAnnotation, "deleted"), (QAExchange, "deleted"),
                                (UserInteraction, "unlinked")):
                tally.add(model.__tablename__, what, count(model, model.article_id.in_(articles)))

        prune_cache_refs(db, tally, boards)
        delete_storyboards(db, tally, boards)
        delete_articles(db, tally, articles)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()

    if not articles and not boards:
        print(f"No seeded rows on {server_db}: nothing to remove.")
        return
    print(f"Removed the seeded demo stories from {server_db}")
    tally.show()


def main() -> int:
    parser = argparse.ArgumentParser(description="Demo AI stories for a LOCAL Guru database (see the module docstring).")
    parser.add_argument("--db", required=True,
                        help="the local Postgres URL, e.g. postgresql://guru@localhost:54329/guru_ui (never read from .env)")
    parser.add_argument("--remove", action="store_true", help="delete every seeded row instead")
    parser.add_argument("--user", default=DEFAULT_USER,
                        help=f"the account that gets two saves and the personal prompts (default {DEFAULT_USER}, '' for none)")
    args = parser.parse_args()

    raw = local_db_url(args.db)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    database = load_app(engine_url(raw))
    try:
        if args.remove:
            remove(database)
        else:
            db = database.SessionLocal()
            try:
                check_local(db)  # before create_tables() writes anything
            finally:
                db.close()
            database.create_tables()
            seed(database, args.user.strip())
    finally:
        database.engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
