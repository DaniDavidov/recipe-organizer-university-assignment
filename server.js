import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import session from "express-session";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "recipe_organizer";

if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI in the .env file.");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new MongoClient(MONGODB_URI);

await client.connect();
console.log("Connected to MongoDB.");

const db = client.db(DB_NAME);
const recipesCollection = db.collection("recipes");
const usersCollection = db.collection("users");

const app = express();

app.use(cors());
app.use(session({
  secret: process.env.SESSION_SECRET || "secret",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.get("/", async (req, res) => {
  try {
    const { category, tag } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (tag) filter.tags = tag;

    const recipes = await recipesCollection
      .find(filter)
      .sort({ rating: -1 })
      .toArray();

    res.render("index", {
      recipes,
      selectedCategory: category || "",
      selectedTag: tag || "",
      success: req.query.success
    });
  } catch (error) {
    console.error("Error loading recipes:", error);
    res.status(500).send("Could not load recipes.");
  }
});

app.get("/register", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("register", { error: null });
});

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.render("register", { error: "All fields are required." });
    }

    const existing = await usersCollection.findOne({ email });
    if (existing) {
      return res.render("register", { error: "Email already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await usersCollection.insertOne({
      username,
      email,
      password: hashedPassword,
      dietary_preferences: [],
      saved_recipes: [],
      created_at: new Date()
    });

    req.session.user = {
      _id: result.insertedId,
      username,
      email
    };

    res.redirect("/");
  } catch (error) {
    console.error("Error registering:", error);
    res.render("register", { error: "Could not register. Try again." });
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render("login", { error: "All fields are required." });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.render("login", { error: "Invalid email or password." });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render("login", { error: "Invalid email or password." });
    }

    req.session.user = {
      _id: user._id,
      username: user.username,
      email: user.email
    };

    res.redirect("/");
  } catch (error) {
    console.error("Error logging in:", error);
    res.render("login", { error: "Could not log in. Try again." });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

app.get("/recipes/new", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.render("new-recipe", { error: null });
});

app.get("/recipes/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const recipe = await recipesCollection.findOne({
      _id: new ObjectId(req.params.id)
    });

    if (!recipe) {
      return res.status(404).send("Recipe not found.");
    }

    res.render("recipe", { recipe });
  } catch (error) {
    console.error("Error loading recipe:", error);
    res.status(500).send("Could not load recipe.");
  }
});

app.get("/authors/:author", async (req, res) => {
  try {
    const author = req.params.author;
    const recipes = await recipesCollection
      .find({ author: author })
      .sort({ rating: -1 })
      .toArray();

    res.render("author", { author, recipes });
  } catch (error) {
    console.error("Error loading author:", error);
    res.status(500).send("Could not load author.");
  }
});

app.post("/recipes", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const { title, category, difficulty, tags, dietary, rating,
            description, prep_time_min, cook_time_min, servings, ingredients } = req.body;

    if (!title || !category) {
      return res.render("new-recipe", { error: "Title and category are required." });
    }

    const tagsArray = tags
      ? tags.split(",").map(t => t.trim()).filter(t => t)
      : [];

    const dietaryArray = dietary
      ? dietary.split(",").map(d => d.trim()).filter(d => d)
      : [];

    const ingredientsArray = ingredients
      ? ingredients.split("\n").map(line => {
          const parts = line.split(",").map(p => p.trim());
          return {
            name: parts[0] || "",
            amount: Number(parts[1]) || 0,
            unit: parts[2] || ""
          };
        }).filter(i => i.name)
      : [];

    await recipesCollection.insertOne({
      title,
      description: description || "",
      category,
      difficulty: difficulty || "easy",
      prep_time_min: Number(prep_time_min) || 0,
      cook_time_min: Number(cook_time_min) || 0,
      servings: Number(servings) || 0,
      tags: tagsArray,
      dietary: dietaryArray,
      ingredients: ingredientsArray,
      rating: Number(rating) || 0,
      author: req.session.user.username,
      user_id: new ObjectId(req.session.user._id),
      created_at: new Date()
    });

    res.redirect("/?success=1");
  } catch (error) {
    console.error("Error saving recipe:", error);
    res.render("new-recipe", { error: "Could not save recipe. Try again." });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

process.on("SIGINT", async () => {
  await client.close();
  process.exit(0);
});